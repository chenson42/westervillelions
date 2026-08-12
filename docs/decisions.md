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

## DECISION-086: Dues Reminder Emails — shared `resolveTreasurer()` extracted to `src/lib/board-positions.ts`; `sendEmail()`/`email_queue` gain `cc`/`bcc`; migration numbers split 0086/0087

**Status:** Resolved
**Date:** 2026-08-12

**Decision:** Phase 3 of the Dues Reminder Emails feature
(`docs/work-log/2026-08-12-dues-reminder-emails.md`) makes three implementation calls beyond what
Phase 2 specified. (1) The "who is the Treasurer" lookup — needed by the dues-reminder signer and
now, per the treasurer's own scope-widening ask, by five existing treasury emails' new CC — is
extracted once into a new `src/lib/board-positions.ts` (`resolveTreasurer()`), rather than
duplicated inside `dues-reminders-queries.ts` a second time. This is exactly the "third consumer"
trigger Phase 2 itself named as the condition for extraction (it declined to extract out of
`/api/public/leadership/route.ts` with only two consumers of differing semantics). (2)
`sendEmail()` gains `cc`/`bcc` options and returns the persisted `email_queue` row's id on every
call; `email_queue` gains matching nullable `cc`/`bcc` columns. `sendBulkMemberEmail()` (from
DECISION-085) is implemented as a thin per-recipient wrapper around `sendEmail()` using a new
internal-only `_bulkMemberSend` flag that widens the existing non-production guard's condition by
one clause (`isClubDistributionList(to) || options._bulkMemberSend`) rather than adding a second
code path — no persistence logic is duplicated. (3) Migration numbering: `0086_dues_reminders.sql`
keeps the number DECISION-085 already assigned it; the new `email_queue` `cc`/`bcc` migration
becomes `0087_email_queue_cc_bcc.sql` rather than colliding with it.

**Rationale:** A resolver duplicated between `dues-reminders-queries.ts` and the ledger routes
would immediately create two places that could disagree about who "the Treasurer" is — the exact
failure mode DECISION-085's own module-boundary reasoning exists to prevent, just one layer up.
The five treasury emails' CC failure mode is deliberately *tolerant* (log and send without a CC)
where the dues-reminder signer is *hard-blocking* (no Send button at all) — two different callers
of the same single source of truth, not two definitions of it. Extending `sendEmail()`'s guard with
one added boolean clause, rather than giving `sendBulkMemberEmail()` its own persistence path,
keeps the "queue insert + blocked-status write" logic in exactly one place, matching DECISION-085's
own instruction to reuse rather than duplicate it.

**Impact:** New file `src/lib/board-positions.ts`, new file `src/lib/dues-reminders.ts` (pure
template rendering), new file `src/lib/dues-reminders-queries.ts` (DB-facing), `src/lib/email.ts`
modified (`cc`/`bcc`, `_bulkMemberSend`, `sendBulkMemberEmail()`), `src/lib/db/schema.ts` modified
(`emailQueue.cc/bcc`, new `duesReminders` table), two new migrations (`0086_dues_reminders.sql`,
`0087_email_queue_cc_bcc.sql`), five existing ledger-route sends gain a CC. Full contract —
API routes, email copy, component plan, edge cases, and the thirteen required unit tests — is in
the Phase 3 section of the work-log linked above.

---

## DECISION-085: Dues Reminder Emails — bulk-send safety guard moves into the shared `email.ts` chokepoint, not a feature-local reimplementation; new `dues_reminders` table, not a reuse of `email_queue`

**Status:** Resolved
**Date:** 2026-08-12

**Decision:** The Dues Reminder Emails feature (`docs/work-log/2026-08-12-dues-reminder-emails.md`,
Phase 2) gets the standard pure/DB-facing module pair — `src/lib/dues-reminders.ts` (template
rendering, pure) + `src/lib/dues-reminders-queries.ts` (cohort via the existing
`listMemberDuesStatus()`, Treasurer signer resolution, reminder-log CRUD) — rather than growing
`dues.ts`/`dues-queries.ts`, following the split DECISION-074 established and DECISION-084
generalized. More significantly: Phase 1 proposed a second, feature-local non-production guard
inside the reminders route that hand-rolls `sendEmail()`'s own `email_queue`/
`blocked_non_production` persistence to keep every real member address from leaving the building
in dev/QA. That is overridden here. The shared guardrail in `src/lib/email.ts`
(`isClubDistributionList()`, added after the 2026-08-09 incident) stays untouched and
address-based for its existing two-distribution-list case, but gains a sibling entrypoint,
`sendBulkMemberEmail()`, that wraps `sendEmail()` per recipient and unconditionally blocks
non-production delivery for *any* bulk-individual-recipient send — no address matching, so it
can't be gamed by a member added to dev data after a list was written — reusing `sendEmail()`'s
existing queue-insert/blocked-status mechanism rather than duplicating it. Data model: a new
`dues_reminders` table (`memberId`, `fiscalYear`, `sentAt`, `sentByUserId`, `signedAsMemberId`,
nullable `emailQueueId` FK with `onDelete: "set null"`, indexed on `(memberId, fiscalYear)` and
`(fiscalYear, sentAt)`), migration `0086_dues_reminders.sql` — not a reuse of `email_queue`, which
has no `memberId`/`fiscalYear` columns and is a delivery log, not a domain record. No new
`FEATURES` key: `dues.manage` already exists and covers the send action; the page and route
handler must each independently enforce it (stricter than the proxy's coarse `dues.view`-level
area gate, derived per top-level path segment from `ADMIN_NAVIGATION`).

**Rationale:** A feature-local safety guard makes protection opt-in per feature — the same shape
that produced the 2026-08-09 incident in the first place, since a future feature that mails
members in bulk and forgets to build its own wall inherits nothing. The existing guard covering
only two named distribution lists is itself the signal that the abstraction is too narrow, not a
reason to keep bolting on parallel walls next to it. Gating on call *shape* (bulk vs.
transactional) rather than on address is also strictly safer than address-matching (today's
guard can be defeated by a fresh member row dev data doesn't yet know is "real") while staying
narrow enough not to break dev testing of every other feature's legitimate single-recipient sends
(password reset, a single minutes-email recipient). `email_queue` was designed as a delivery log
(free-text `to`, no member linkage) and matching "who was reminded, for which year" against it
would be fragile by construction — the badge query in Flow 3 needs a real domain record, not a
best-effort text match.

**Impact:** `src/lib/email.ts` gains `sendBulkMemberEmail()` as a second sanctioned entrypoint
alongside `sendEmail()` — any future "email many members at once" feature is expected to reach for
it rather than looping `sendEmail()` directly; a feature that hand-loops `sendEmail()` instead is a
visible, reviewable deviation from this precedent. New table `dues_reminders` + migration `0086`.
No new `FEATURES` key or permissions migration. Full ruling, including the server/client split and
the `/admin/dues/reminders` nested-page gating nuance (proxy admits at `dues.view`, page/route must
independently enforce `dues.manage`), is in the Phase 2 section of the work-log linked above.

---

## DECISION-084: Project/Activity Proposal form — new top-level module pair, one-key permission gate, two-table append-only decision history

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** The Project/Activity Proposal feature (`docs/work-log/2026-08-09-project-proposal-form.md`,
Phase 2) gets a new top-level lib module pair — `src/lib/proposals.ts` (pure helpers/validators) +
`src/lib/proposals-queries.ts` (DB-facing) — following the split DECISION-074 established for
minutes/documents, generalized to a third domain rather than folded into `ledger-*` or `minutes.ts`.
Member surface lives at `src/app/members/proposals/` (flat top-level directory, following the
`members/reimbursements/` / `members/financial-reports/` "any linked member, no `FEATURES` gate" shape,
not the `records/` hub shape — proposals is one feature, not a federation of two). Admin surface lives at
`src/app/(dashboard)/admin/proposals/`, gated by one new key, `FEATURES.PROPOSALS_REVIEW`
(`"proposals.review"`), bound to `admin` + `board_member` via a new idempotent migration (`0084_*`) —
one key covers both viewing submitted proposals and deciding them, matching `DOCUMENTS_MANAGE`'s
precedent (one role authors and adopts) rather than the Ledger's view/record/approve split, whose
separation-of-duties reasoning is money-specific and doesn't transfer to a once-a-month board vote.
No new npm dependency: the form is hand-rolled `useState` + `fetch`-to-route-handler, matching every
existing form including the closest analog (`reimbursement-form.tsx`); `react-hook-form` stays
installed-but-unused rather than adopted for this one feature (flagged separately for the 30-day
dependency review — remove it or adopt it project-wide on purpose, not implicitly via this feature).
Data model is two tables, not one: `proposals` (one row per proposal, mutable while
`status` is `Draft`/`Submitted`, denormalized current `status` column) + an append-only
`proposalDecisions` history table (one row per status transition, reusing the `documentVersions` shape:
`decidedByUserId` / `decidedAt` / `citingMinutesId`, nullable and backfillable).

**Rationale:** Reuses three precedents already proven in this codebase (module-pair split, any-linked-
member gating, `DOCUMENTS_MANAGE`-style single review key) instead of inventing new shapes. The two-table
decision history departs from a single mutable decision-column set specifically because `Deferred` is a
routine, repeatable transition (a board can defer the same proposal in consecutive months) — a mutable
column set would silently overwrite an earlier deferral's `decidedAt`/`decidedByUserId` the moment a later
decision is recorded, losing exactly the "who decided what, when" audit trail this club's governance
culture already expects elsewhere (`documentVersions`, permanently-retained minutes).

**Impact:** New tables `proposals` and `proposalDecisions` land in `schema.ts` first, then a matching
idempotent migration; new `FEATURES.PROPOSALS_REVIEW` key + role-binding migration; new
`ADMIN_NAVIGATION` entry (so `getAdminProtectionRules()` derives proxy protection per DECISION-082); the
admin page must still carry its own `auth()` + `hasFeature()` check per
`src/lib/admin-page-feature-gates.test.ts`. Two new top-level directories
(`src/app/members/proposals/`, `src/app/(dashboard)/admin/proposals/`); no new dependencies. Tech-lead
designs the detailed schema/API contract in Phase 3, including a tri-state (value + "not sure yet" flag)
shape for the money/date/headcount fields rather than overloading `NULL`.

---

## DECISION-083: Newsletter subscriber PII gets its own permission key, `subscriptions.view` — not a reuse of `contact.view` — closing the Phase 5 re-verification FAIL on `/admin/subscriptions`

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** New key `FEATURES.SUBSCRIPTIONS_VIEW = "subscriptions.view"` ("View the newsletter
subscriber list and export subscribers"), bound via `drizzle/migrations/0083_subscriptions_view_permission.sql`
to exactly the two roles that already held `contact.view` — `admin` and `board_member` — a like-for-like
swap, not a widening or narrowing of who can reach the subscriber list. `contact.view` is untouched
everywhere, including on `/admin/contact`. `ADMIN_NAVIGATION`'s "Newsletter" item (`src/lib/permissions.ts`)
now declares `requiredFeature: FEATURES.SUBSCRIPTIONS_VIEW` instead of `FEATURES.CONTACT_VIEW`;
`/admin/subscriptions/page.tsx` gates on the same key; `/api/admin/newsletter/export/route.ts` now checks
`hasAnyFeature([SUBSCRIPTIONS_VIEW, REPORTS_EXPORT])` instead of `REPORTS_EXPORT` alone (a second,
adjacent "wrong key" gap found while fixing the page — see Impact).

**Rationale:** The Phase 5 re-verification of docs/work-log/2026-08-09-governance-document-versioning.md's
DECISION-082 loop-back found `/admin/subscriptions` performing `auth()` only, no `hasFeature()` call at
all — a `contact.view`-only account could read every subscriber's name and email. The obvious first fix
was to gate on `contact.view`, matching the nav item's existing (pre-refactor) declaration and closing the
FAIL with a one-line change. That was rejected in favor of a dedicated key for a reason stronger than
taste: `contact.view` was seeded with the description "View contact form submissions" (migration 0007) —
a genuinely different dataset (people who filled out the contact form) than newsletter subscribers (people
who opted into the mailing list). Reusing it is the exact "wrong key, not missing key" pattern DECISION-082
itself already found and fixed once, for `/admin/members` vs `/admin/membership`. This was confirmed
empirically, not just argued: qa's own regression spec (`e2e/admin-subscriptions-page-gate.spec.ts`)
composes its fixture by granting `contact.view` to an otherwise-unprivileged role specifically to prove
the pre-fix vulnerability — which means a fix that gates on `contact.view` cannot make that spec pass,
since the fixture legitimately holds that key. Matching the nav's pre-existing key would have "fixed" the
FAIL on paper while leaving the exact account shape the regression test was built to catch still able to
see the page. The task brief explicitly reserved the "invent a new key" decision for a recommendation, not
a unilateral implementation — but a required, already-written regression test that only a dedicated key
can satisfy removes that ambiguity: this is what closing the FAIL actually requires, not a preference.

**Impact:** `src/lib/permissions.ts` (`FEATURES.SUBSCRIPTIONS_VIEW`, `FEATURE_DESCRIPTIONS` entry,
`FEATURE_CATEGORIES.SUBSCRIPTIONS`, `ADMIN_NAVIGATION`'s Newsletter item), new migration
`drizzle/migrations/0083_subscriptions_view_permission.sql` (run against dev via `pnpm db:migrate`,
confirmed via `psql`: `admin` and `board_member` both hold the new key, `contact.view` unchanged),
`src/app/(dashboard)/admin/subscriptions/page.tsx` (page-level gate added, using the new key),
`src/app/(dashboard)/admin/permissions/page.tsx` (separate, pre-existing missing-gate defect closed in
the same pass — `auth()` + `hasFeature(ADMIN_ROLES)` added, matching `/admin/roles`'s own pattern),
`src/app/api/admin/newsletter/export/route.ts` (an adjacent latent gap found while auditing this PII
surface: the export endpoint checked `REPORTS_EXPORT` alone — a generic, cross-cutting export permission
also used by `dues`/`ledger`/`members` exports — with no relationship to `contact.view` or the new
`subscriptions.view`; not live-exploitable today since only `admin`/`board_member` hold `reports.export`
and both already hold `subscriptions.view`, but a future role granted `reports.export` for an unrelated
report would have silently gained the ability to download the full subscriber PII list. Changed to
`hasAnyFeature([SUBSCRIPTIONS_VIEW, REPORTS_EXPORT])`, matching the OR-pattern `dues/export` and
`ledger/export` already use). New static regression test `src/lib/admin-page-feature-gates.test.ts`
(67 tests) asserting every top-level `/admin/*` area is declared in `ADMIN_NAVIGATION` and every such
page's `page.tsx` calls a permission-gate function, with a small documented allowlist (`sync-log`,
`release-notes`) for the two areas ADMIN_NAVIGATION itself designs to have no permission of their own —
confirmed non-vacuous by reverting the two page fixes and re-running (3 tests failed for the right
reason, restored, re-ran green). **Not fixed, flagged as a follow-up:** `/api/admin/members/export/route.ts`
has the identical standalone-`REPORTS_EXPORT` shape as the newsletter export route did — not
live-exploitable today for the same reason (`reports.export` currently implies `admin`/`board_member`
only), but out of this pass's scope (a members-data question, not a subscriptions one) and worth its own
look. See `docs/work-log/2026-08-09-governance-document-versioning.md`'s Phase 4 loop-back 2 for the full
22-area admin-page audit this decision closes out.

---

## DECISION-082: Admin proxy route-protection rules are derived from `ADMIN_NAVIGATION`, not hand-maintained in `src/proxy.ts` — ends the 5x-recurring "new admin area, missing proxy rule" bug class structurally

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** `src/proxy.ts`'s `protectionRules` array no longer hand-lists which feature(s) admit each admin sub-area. `getAdminProtectionRules()` (new, `src/lib/permissions.ts`) walks `ADMIN_NAVIGATION` itself, groups items by the top-level path segment under `/admin/` (e.g. "ledger", "minutes", "documents"), and unions each segment's items' `requiredFeature`(s) into one rule per segment. `proxy.ts` calls this function directly (`...getAdminProtectionRules()`) instead of maintaining a parallel list; the generic `ADMIN_DASHBOARD` catch-all and the `/members` rule are the only rules still hand-written, since neither derives from a nav item. Segment patterns are bounded (`^/admin/<segment>(?:/|$)`, not a bare prefix) so a segment name can never accidentally also match a longer sibling segment (e.g. "members" matching "membership").

**Rationale:** This is the fifth recorded instance of the same defect — an admin area ships gated on a permission narrower than `admin.dashboard`, but nobody remembers to also add a matching `protectionRules` entry, so the intended holder of that narrower permission is bounced to `/access-pending` by the generic catch-all before the page's own, correct `hasFeature()` check ever runs (budget-committee ×2, `/admin/ledger`, `/admin/minutes`, `/admin/documents` — see `docs/work-log/2026-08-05-admin-area-gating.md` and `docs/work-log/2026-08-09-governance-document-versioning.md`'s Phase 4 loop-back). The previously-raised objection to deriving one list from the other was real and specific: several existing rules need "any of several features admitting one area" (e.g. Ledger's eight nav items each requiring a different feature, all of which should admit `/admin/ledger*`) while `ADMIN_NAVIGATION` was assumed to model one feature per nav item. That objection dissolves on inspection — `AdminNavItem.requiredFeature` already supports `FeatureName | FeatureName[]` (used by Budgeting today), and grouping by top-level segment and unioning across every item in that segment reproduces the "any of several features" shape the hand-written Ledger rule needed without inventing a second mechanism. The one real gap found while verifying exact preservation: the hand-written `/admin/minutes` rule admitted `MINUTES_DELETE` in addition to `MINUTES_MANAGE`, but the Minutes nav item declared only `MINUTES_MANAGE` — closed by adding `MINUTES_DELETE` to that item's `requiredFeature` array (inert in practice, since only `admin` — who bypasses the proxy entirely — holds `minutes.delete`), rather than by inventing a separate override list, keeping `ADMIN_NAVIGATION` the actual single source of truth rather than "the source of truth plus a side list of exceptions."

**Impact:** `src/proxy.ts` no longer needs a manual edit when a new `ADMIN_NAVIGATION` item ships with a `requiredFeature` other than `ADMIN_DASHBOARD` — the derivation picks it up automatically, closing the specific failure mode behind all five prior incidents. Verified byte-for-byte preservation of the eight pre-existing hand-written rules (`members`, `users`, `roles`, `permissions`, `campaigns`, `groups`, `ledger`, `minutes`) via a pinned regression test (`src/lib/permissions.test.ts`, `getAdminProtectionRules` describe block) and the full e2e suite. As a side effect, eleven admin areas that had a nav entry with a narrower-than-`admin.dashboard` `requiredFeature` but no explicit proxy rule (`membership`, `dues`, `documents`, `events`, `announcements`, `testimonials`, `programs`, `subscriptions`, `contact`, `suggestions`, `security`) are now correctly proxy-admitted for their own feature-holders instead of silently requiring `admin.dashboard` — this is a genuine widening, but not a broadening of authority: every one of those pages already enforces its own `hasFeature()` check at the page level (audited in the Phase 4 loop-back work-log), so the proxy layer now simply stops rejecting legitimate holders before that check runs. **What this does NOT guarantee**, stated plainly rather than overclaimed: an admin page that is never added to `ADMIN_NAVIGATION` at all (not merely missing a proxy rule, but absent from the nav data itself) has no `requiredFeature` for this function to read and still falls to the `ADMIN_DASHBOARD` catch-all — a different, so-far-unobserved failure mode this change does not close.

---

## DECISION-081: Governance Documents — `documents.currentVersionId` ships with NO database-level FK constraint (app-enforced only), closing the circular-FK question DECISION-076 left open

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** `documents.currentVersionId` is a plain `uuid NULL` column with no `.references()` in
`schema.ts` and no `ALTER TABLE ... ADD CONSTRAINT` in the migration. `documentVersions.documentId →
documents.id` keeps its normal forward FK (no ordering problem there). Enforcement of "the pointer
always references a real, matching version" is entirely in `documents-queries.ts`, which is the only
code path that ever writes `currentVersionId` and always does so inside the same transaction as the
version row it points to.

**Rationale:** DECISION-076 (architect, Ruling 1) named two options for the `documents` ↔
`documentVersions` circular table-creation dependency and left the choice to database-admin at Phase
4: a real FK added via a guarded `ALTER TABLE` in a third migration statement, or no DB-level
constraint at all (DECISION-041 precedent). Deciding now, in Phase 3, rather than leaving it for
Phase 4 to rediscover: this project's build pipeline runs `pnpm db:migrate` (raw SQL) and then
`drizzle-kit push --force` on every deploy (CLAUDE.md, Common Commands). A constraint added by raw
SQL but never declared in `schema.ts` is exactly the shape of drift `push --force` can treat as
unmanaged and drop — turning a nominally idempotent migration into a constraint that silently
disappears on the deploy immediately after it's added, or reappears/vanishes depending on push
ordering. That risk is concrete and specific to this codebase's pipeline, not a generic caution, so
it's worth resolving before an implementer hits it as a surprise mid-build rather than as a design
choice.

**Impact:** `src/lib/db/schema.ts`'s `documents` table declares `currentVersionId` with no
`.references()` call; the migration is two plain `CREATE TABLE IF NOT EXISTS` statements with no
guarded `ALTER TABLE` step. `documents-queries.ts` is the sole writer of `currentVersionId` and must
keep every write to it inside the same transaction as the version insert/adopt it accompanies — this
is a code-review invariant for that file going forward, not just a one-time implementation note. See
`docs/work-log/2026-08-09-governance-document-versioning.md`, Phase 3, "Data Model."

---

## DECISION-080: Meeting Minutes — notetaker-of-record field: nullable member FK + write-time name snapshot, resolved server-side, never shown alongside `authorUserId` (further Phase 4 increment)

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** `minutes` gains `notetakerMemberId` (nullable, `ON DELETE SET NULL` to `members.id`) and
`notetakerNameSnapshot` (nullable `text`) — the notetaker *of record*, i.e. who took the minutes,
selectable via a member picker in the admin editor and shown on both the admin/member detail views and
the emailed version. This is explicitly **not** a replacement for `authorUserId` (data-entry
attribution — whoever created/is editing the row), which continues to be stamped from the session and,
per this decision, continues to be shown nowhere in the UI — confirmed via `grep` that it was never
displayed before this change either, so choosing not to surface it is a continuation of existing
practice, not a new omission.

Both new columns are **nullable**, deliberately unlike `minutesAttendance.memberNameSnapshot`'s old `NOT
NULL`: that `NOT NULL` was safe because an attendance *row* only ever existed once a member had been
picked (the row's existence implied a name). Here the notetaker is one optional field on a row that
always exists regardless of whether a notetaker was ever recorded — historical minutes entered later may
have no clear record of who took them, and forcing a value would fabricate data rather than capture
accountability. The FK/snapshot *pairing* itself, though, follows the shape the schema already got right
for the (now-removed) attendance design exactly: nullable member FK with `ON DELETE SET NULL` so a hard
member-delete degrades gracefully, paired with a name snapshot that is the sole display source of truth
and is **never** recomputed from, or invalidated by, the current roster. A notetaker who later resigns
still shows as the notetaker of that meeting, forever — only a hard member-delete nulls the FK, and even
then the name snapshot survives untouched.

The name snapshot is resolved **server-side**, not trusted from client-supplied text: the client submits
only `notetakerMemberId`; the route (`POST /api/admin/minutes`, `PATCH .../[id]` `{action:'update'}`)
calls a new `getMemberNameSnapshot(memberId)` in `minutes-queries.ts` — a plain `members` lookup — and
snapshots the current `"{firstName} {lastName}"` at that exact write. An id that doesn't resolve to an
existing member 400s before `createMinutes()`/`updateMinutesDraft()` is ever called, rather than writing
a row with a dangling/guessed name. This mirrors the removed `minutesAttendance` design's own
`snapshotMemberNames()` precedent (member FKs get canonical, server-resolved names; free-text fields like
motions' `moverName`/`seconderName` and action items' `ownerName` — which can legitimately name a
non-member guest — do not).

The picker (`getMinutesFormMemberOptions()` in `minutes-admin-form-data.ts`) lists **every** member,
active or not — deliberately unfiltered, unlike the active-only convention `link-member-form.tsx`'s
caller (`/admin/users`) uses — because editing or backfilling a historical minutes record must still be
able to name a notetaker no longer active; a currently-inactive member's option label is suffixed `"(no
longer active)"` so the picker stays legible about the live roster without hiding anyone. The form
defaults the picker to the signed-in user's own linked member id (`session.user.memberId`) **only** when
no notetaker has been recorded yet (a fresh create, or a still-unset draft) — an already-recorded
notetaker is never silently overridden by whoever next opens the record, and the picker is always freely
changeable regardless of the default, per the treasurer's own framing ("select who the notetaker is if
someone else is entering the notes online").

Display: a "Recorded by {name}" line (or "not recorded" when null) sits directly under the meeting date
in `MinutesDetail` (shared by the admin read-only view and `/members/records/[id]`) and directly under
the meeting date in the emailed HTML (`minutes-email-render.tsx`), ahead of the sender's optional note —
minutes conventionally name their recorder near the top of the record, not buried in the body. Not added
to the admin list table (`/admin/minutes`) — the brief asked for the detail view and the email, not the
summary list; a future increment can add it there if that need surfaces.

**Rationale:** The record's existing `authorUserId` answers "who did the data entry," not "who took the
notes" — the secretary may take notes on paper and someone else types them up later, or a substitute may
cover a meeting, so the two are frequently different people. Minutes conventionally name their recorder
as a governance fact, not a UI nicety, which is why this is a first-class column pair rather than free
text folded into `bodyMarkdown`. Nullable-both (rather than reusing attendance's `NOT NULL` snapshot
shape verbatim) is the correct read of "consider that historical minutes may be entered later with no
clear record of who took them" — an unrecorded notetaker is a real, expected state, not an error.
Server-side name resolution (rather than trusting client-submitted text, the way motions/action-items'
free-text names are trusted) is the correct read of "follow the pattern the schema already got right for
attendance" — attendance's one FK-to-roster field always got its display name from a live `members`
lookup at write time, never from client text, and that's the property worth preserving for a second
FK-to-roster field.

**Impact:** `src/lib/db/schema.ts` (`minutes.notetakerMemberId`/`notetakerNameSnapshot`, new
`ix_minutes_notetaker` index), `drizzle/migrations/0079_meeting_minutes.sql` (amended in place — see that
file's header for why amending rather than a follow-up migration is safe here, same reasoning
DECISION-079 already established: never committed to git, never shipped), `src/lib/minutes-queries.ts`
(`CreateMinutesInput`/`UpdateMinutesInput`/`MinutesDetail` gain the two fields; new
`getMemberNameSnapshot()`), both `/api/admin/minutes*` route files (server-side resolution + 400 on an
unresolvable id), `src/lib/minutes-admin-form-data.ts` (new `getMinutesFormMemberOptions()`),
`minutes-form.tsx` (picker UI + default-to-self logic), `minutes-editor-shell.tsx` and both
`/admin/minutes` pages (threading `memberOptions`/`currentMemberId`), `minutes-detail.tsx` and
`minutes-email-render.tsx` (display). Unit tests added in `minutes-queries.test.ts` (`getMemberNameSnapshot`),
a new `src/app/api/admin/minutes/route.test.ts` (POST-create notetaker resolution — this route had no
prior dedicated test file), `[id]/route.test.ts` (PATCH-update notetaker resolution, including the
"omitted key leaves it unchanged" contract), and `[id]/email/route.test.ts` (the rendered "Recorded by"
line). `pnpm exec tsc --noEmit` clean, `pnpm test` at 1263 (no regression from the 1251 baseline; +12 new
tests), `pnpm build:only` clean. Migration applied to the dev database only (`DATABASE_URL`, confirmed by
hostname distinct from `PROD_DATABASE_URL`) — production was never touched.

---

## DECISION-079: Meeting Minutes — attendance is a single headcount, not a per-member roster; `minutesAttendance` dropped entirely (Phase 4 loop-back, supersedes DECISION-078)

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** The treasurer clarified the actual requirement mid-implementation, after DECISION-078 had
already fixed a data-loss defect in the per-member design: *"I wanted a single count number for
attendance."* This is not a refinement of DECISION-078's merge contract — it eliminates the per-member
model the defect lived in. `minutesAttendance` (the child table: `memberId` FK, `memberNameSnapshot`,
`present`, the unique `(minutesId, memberId)` constraint, its two indexes) is **removed outright**, not
deprecated or soft-migrated. `minutes` gains one nullable `present_count integer` column instead — a
plain scalar alongside `title`/`bodyMarkdown`, set or left null on every create/update exactly like any
other content field.

Because `drizzle/migrations/0079_meeting_minutes.sql` had never been committed to git (confirmed via
`git ls-files`/`git log` — untracked at the time of this pivot) and therefore had never shipped to any
deployed database, it was **amended in place** rather than followed with a separate drop migration —
there is no production state to migrate away from; the amended file IS the first version anyone will
ever run. The one local dev database that had already applied the pre-pivot migration got a direct,
one-off `DROP TABLE minutes_attendance CASCADE` (dev-only, never production) so its schema matches the
amended migration exactly, plus a re-run of `pnpm db:migrate` to pick up the new
`ALTER TABLE minutes ADD COLUMN IF NOT EXISTS present_count integer` (idempotent, safe on any
environment regardless of which shape of `0079` it last ran).

Every consumer of the removed per-member shape was rewritten to the scalar, not patched around it:
`minutes-queries.ts` (`createMinutes`/`updateMinutesDraft` take `presentCount` instead of an
`attendance` array; `getMinutesDetail`/`listMinutesForAdmin`/`listMinutesForMembers` return
`presentCount` directly off the `minutes` row, no join; `searchMinutes` drops the
`minutesAttendance.memberNameSnapshot` search branch entirely — a number isn't a searchable name), both
`/api/admin/minutes*` routes (`parseAttendance()` replaced by `parsePresentCount()`, a non-negative-
integer-or-null validator), the admin editor (`AttendanceChecklist` and its roster-fetching
`getMinutesFormRoster()` deleted outright; `MinutesForm` gains one plain number input), the email
renderer (`minutesEmailMarkdownComponents` present/absent name lists replaced by one "Present: N" line),
and the member-facing `MinutesDetail` component (same simplification). DECISION-078's merge-vs-replace
contract question, and the data-loss defect it fixed, are moot with no child-row array left to lose
anything from — its regression test, `e2e/minutes-attendance-snapshot-survival.spec.ts`, was deleted
(not adapted) since it tests a concept that no longer exists.

**Rationale:** Building the exact contract the requester asked for beats repairing a more elaborate one
they didn't. The per-member design (attendance rows FK'd to `members`, a roster checklist UI, a
name-snapshot survival guarantee) was a reasonable-looking elaboration of "record who attended," but it
was never actually requested — DECISION-074's original brief described a "roster checklist" without the
treasurer ever having been asked "roster, or just a number?" Once asked directly, the answer was the
simpler shape, and it was still uncommitted, so the honest move was to replace it rather than carry
merge-semantics complexity (DECISION-078) forward in service of a data model nobody wanted. This also
resolves DECISION-078's own accepted last-write-wins concurrency gap for attendance specifically — a
single scalar column has no row-omission failure mode to begin with; ordinary last-write-wins on a
scalar field (already accepted for `title`/`bodyMarkdown`) is all that's left.

**Impact:** Schema: `src/lib/db/schema.ts` (`minutesAttendance` table removed; `minutes.presentCount`
added), `drizzle/migrations/0079_meeting_minutes.sql` (amended in place, not a new migration file).
Server: `src/lib/minutes-queries.ts`, `src/app/api/admin/minutes/route.ts`,
`src/app/api/admin/minutes/[id]/route.ts`, `src/components/admin/minutes/minutes-email-render.tsx`.
Client: `src/components/admin/minutes/minutes-form.tsx` (rewritten), `attendance-checklist.tsx`
(deleted), `minutes-editor-shell.tsx`, `src/lib/minutes-admin-form-data.ts` (`getMinutesFormRoster`
deleted), `src/components/minutes/minutes-detail.tsx`, both `/admin/minutes` pages. Tests:
`src/lib/minutes-queries.test.ts` (DECISION-078's merge-contract block removed; `searchMinutes` fixture
updated), `src/app/api/admin/minutes/[id]/email/route.test.ts` (fixture updated), and
`e2e/minutes-attendance-snapshot-survival.spec.ts` (deleted). No unrelated test coverage was lost —
`pnpm test` returns to the exact same 1246 count qa's Phase 5 report recorded as the pre-loop-back
baseline. A future quorum check (still deliberately not built, per the treasurer's standing decision) is
a direct, obvious consumer of `presentCount` against the by-laws' "majority of the members in good
standing" threshold for a regular meeting — noted, not built.

---

## DECISION-078: Meeting Minutes — attendance-update contract changed from whole-array-replace to merge-only (Phase 4 loop-back) — SUPERSEDED by DECISION-079

**Status:** Superseded by DECISION-079
**Date:** 2026-08-09

**Decision:** `PATCH /api/admin/minutes/[id]` `{action:'update'}`'s `attendance` array is no longer
delete-then-reinserted. `updateMinutesDraft()` now **upserts** each submitted `{memberId, present}`
entry by the existing `(minutesId, memberId)` unique constraint (`ON CONFLICT ... DO UPDATE`) and
**never deletes a `minutesAttendance` row through this action, under any circumstances.** An
attendance row that exists but isn't mentioned in a given payload is left completely untouched.
`motions`/`actionItems` are explicitly **not** included in this change — they keep the
delete-then-reinsert semantics DECISION-077/Phase 3 already specified; this loop-back is scoped to
attendance only, per the treasurer's own framing ("attendance should have nothing to do with members
records") and qa's Phase 5 finding, not a general re-litigation of the update contract.

Paired UI change: `AttendanceChecklist` now renders every attendance row already on the record whose
member is off the live active/prospective roster as an **editable** checkbox (defaulting to its
last-recorded `present` value), not a read-only informational line — the notetaker must deliberately
uncheck a former member to record them absent; simply saving an unrelated edit leaves their row
exactly as it was. A row whose `memberId` has gone `NULL` (the member was hard-deleted, not just
resigned) has no live id to upsert against and is shown as a plain, non-interactive line — it survives
automatically because nothing in the new contract ever deletes it.

**Rationale:** qa's Phase 5 finding (`docs/work-log/2026-08-08-meeting-minutes.md`) reproduced concrete
data loss: an ordinary `membershipStatus -> 'ended'` resignation, followed by any unrelated save,
silently destroyed the resigned member's attendance row and its `NOT NULL memberNameSnapshot` — even
though the schema (`memberId` nullable + `ON DELETE SET NULL`, paired with the snapshot column) was
explicitly built so the row survives. The Phase 3 API contract's "attendance... fully replace... when
present, delete-then-reinsert" was the actual defect: any client whose payload can only reflect the
*current* roster (which every realistic client must, since it's rendering a checkbox list) will
necessarily omit anyone no longer on that roster, and delete-then-reinsert treats that omission as "this
person's attendance is deleted" rather than "the client doesn't have an opinion about this row." Merge
semantics (upsert what's given, never delete what's omitted) makes the loss structurally impossible
rather than relying on every future client to remember to round-trip every former-member row it's shown.
This also strengthens the accepted "last write wins" concurrent-edit gap named in Phase 3's Edge Cases:
two notetakers saving concurrently can no longer cause one save to delete the other's freshly-added
attendance row for a member the first payload didn't happen to mention (whether because that member
just resigned, or was just added by the other editor) — only the shared `present` value of a row **both**
payloads mention can still race, which is the narrower, already-accepted gap.

**Impact:** `src/lib/minutes-queries.ts` (`updateMinutesDraft()` attendance handling — upsert loop, no
delete), `src/components/admin/minutes/attendance-checklist.tsx` (former-attendee rows become editable
checkboxes when `memberId` is non-null), `src/components/admin/minutes/minutes-form.tsx` (former-attendee
state merged into the submitted `attendance` payload), `src/app/api/admin/minutes/[id]/route.ts`
(doc-comment only — `parseAttendance()`'s shape validation is unchanged since the wire shape didn't
change, only what the server does with it). New unit test coverage in `minutes-queries.test.ts` asserts
`minutesAttendance` is never targeted by `tx.delete()` inside `updateMinutesDraft()`, closing the
coverage gap qa's Phase 5 report named explicitly ("a direct unit test... would have made the
whole-array-replace behavior obvious immediately"). No schema or migration change — the nullable
`memberId` / `ON DELETE SET NULL` / `NOT NULL memberNameSnapshot` shape was already correct; only the
application layer defeated it.

---

## DECISION-077: Meeting Minutes — Phase 3 implementation calls: `minutes.title` (nullable, disambiguation only) added beyond the architect's column list; motions' mover/seconder and action items' owner are free text, NOT `members` FKs (attendance stays the one FK-to-roster per DECISION-074 Ruling 3); `escapeIlikeTerm()` duplicated into `minutes.ts` rather than imported from `ledger.ts`; `MINUTES_KIND_EMAIL` values are `{address, requiresApproval}` objects, not bare strings, to encode the treasurer's send-gating rule in data; Word-paste HTML pre-clean is pure string transforms so it stays unit-testable without adding `jsdom`; member-facing route is `/members/records` ("Club Records" tile) while admin nav and the `src/lib/minutes*`/`src/components/minutes/` module names stay "minutes"; `minutesAttendance.memberId` is nullable `ON DELETE SET NULL` with a denormalized `memberNameSnapshot`; reopening approved minutes does not clear `approvedByUserId`/`approvedAt`; no unique constraint on `(kind, meetingDate)`

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** Phase 3 technical-design calls for `docs/work-log/2026-08-08-meeting-minutes.md`,
filling in the shape-level details DECISION-074/075 (architect) deliberately left to tech-lead ("exact
DDL is database-admin's call," "file location TBD by tech-lead").

1. **`minutes` gets one column beyond the architect's Ruling 3 list: `title text NULL`.** Two minutes
   records can legitimately share a `kind` and `meetingDate` (edge case: two sets of minutes for one
   meeting — no unique constraint prevents this, see #9 below), and search results need a human-scannable
   label. `title` is optional — the UI falls back to `"{kind} minutes — {meetingDate}"` when null. Not a
   structural change to anything the architect ruled on, additive only.
2. **Motions' mover/seconder and action items' owner are plain `text` columns, not FKs to `members`.**
   DECISION-074 Ruling 3 FK'd attendance to `members` for a specific, stated reason — Flow 2 describes it
   as "a roster checklist," an explicit member-picker UI concept. Motions/action items were never given
   that same treatment: Flow 2 describes them as free-form "(text, mover, seconder, result)" /
   "(text, owner, due date)" with no picker UI implied. Forcing a member-FK here would be over-structuring
   exactly the failure mode the brief warned about (item 2: "over-structuring makes the secretary's weekly
   job worse") — a mover or seconder is sometimes a guest, and typing a name is strictly lower-friction
   than cross-referencing the roster for a fact that, unlike attendance, this club has no stated intent to
   ever query by member identity. The client UI may typeahead-suggest against active member names for
   convenience; the stored value is always the text the notetaker ended up with. This also sidesteps the
   snapshot problem entirely for these three fields — there's no live FK to go stale when a member is
   later deleted, because there was never a FK to begin with.
3. **`escapeIlikeTerm()` is duplicated (not imported) into `minutes.ts`.** The existing implementation
   lives in `src/lib/ledger.ts:2238`, exported and otherwise reusable verbatim. Importing it into
   `minutes-queries.ts` would create a real `minutes → ledger` module dependency — exactly the coupling
   DECISION-074 Ruling 2 ruled out ("minutes shares no tables, no permission keys, and no audience
   boundary with the Ledger; prefixing it `ledger-*`... would misrepresent it as a Ledger sub-feature").
   The function is two lines of pure string-escaping with no ledger-specific meaning; duplicating it costs
   nothing and preserves the module-independence the architect was explicit about.
4. **`MINUTES_KIND_EMAIL` values are `{ address: string; requiresApproval: boolean }` objects, not bare
   address strings.** DECISION-075 ruled the map itself (partial, hardcoded, co-located with
   `MINUTES_KINDS`) but not this detail. The treasurer's later send-gating decision — "drafts MAY be
   emailed to `board@` at any status; `club@` receives minutes ONLY once approved" — is a per-recipient
   policy, not a per-`kind` string comparison, and hard-coding "if kind === 'general'" into the email route
   would silently stop being correct the day a second kind is ever mapped to `club@` or to some other
   whole-membership list. Encoding `requiresApproval` on the map entry itself keeps the policy declarative
   and co-located with the address it governs, matching DECISION-075's own stated reason for co-locating
   the map with `MINUTES_KINDS` in the first place (same cadence, same actor, same file).
5. **The Word-paste HTML pre-clean (un-faking `mso-list` pseudo-bullets, flagged as a real implementation
   gap by DECISION-074 Ruling 1) is written as pure string/regex transforms over the raw clipboard HTML
   string, run BEFORE handing the cleaned string to `turndown`— not as a `DOMParser`/DOM-walk pass.**
   This is a real constraint, not just a style preference: this project's Vitest config
   (`vitest.config.ts:7`) runs `environment: "node"`, and no `jsdom`/`happy-dom` dependency exists in
   `package.json` today. A DOM-walk implementation would only be testable by adding a new devDependency
   purely to unit-test one helper — a dependency question nobody has evaluated. Turndown's own DOM-consuming
   conversion is a mature, independently-tested library and does not need re-testing here; the
   project-authored pre-clean logic is exactly the part that does, and writing it as string transforms
   keeps that coverage inside the existing test setup at zero new dependency cost. `turndown` itself is
   still only ever invoked from the `"use client"` editor component, unchanged from Ruling 1.
6. **Member-facing route is `/members/records` (tile: "Club Records"); admin routes, `src/lib/minutes.ts`
   /`minutes-queries.ts`, and `src/components/minutes/`/`src/components/admin/minutes/` keep the "minutes"
   name.** The brief for this design ("the Minutes tile will later also hold governing documents — name it
   accordingly, but do not build that") only extends to the member-facing surface a member actually clicks
   — the admin sidebar entry, the module/file names, and the component directories the architect already
   ruled on (DECISION-074 Ruling 2) describe what the code IS today (minutes only), not what the tile will
   grow into. Renaming ruled module names to anticipate an unbuilt feature would be scope creep in the
   other direction. `/members/records` is a pure routing/label choice sitting on top of unchanged
   `minutes.ts`/`minutes-queries.ts` logic — when documents ship, the route gains a second section; nothing
   here needs to move.
7. **`minutesAttendance.memberId` is nullable, `ON DELETE SET NULL`, with a `memberNameSnapshot text NOT
   NULL` captured at attendance-row creation.** Minutes retention is permanent (Phase 1 research,
   DECISION-074's own citation of it), but member deletion is a real hard-delete
   (`src/app/api/admin/members/[id]/route.ts:233`, `db.delete(members)...`, not a soft-delete). A plain
   `NOT NULL` FK with `ON DELETE SET NULL` — the pattern already sitting uncorrected in
   `ledgerReimbursements.submittedByUserId` (schema.ts:1236) — would throw a not-null-violation the moment
   a member with attendance history is ever deleted, silently blocking a routine admin action. Making the
   column nullable and snapshotting the name at write time means a later member deletion degrades the row
   gracefully (the fact "Jane Doe — present" survives) rather than erroring or silently losing the record.
   Not fixing the pre-existing `ledgerReimbursements` inconsistency here — out of scope, flagged for the
   30-day code review.
8. **Reopening an approved minutes record does not clear `approvedByUserId`/`approvedAt`.** Mirrors
   `ledgerBudgetApprovals`' own stated design ("neither clears the other, so the most recent lock and most
   recent unlock are both visible at once," schema.ts:1016-1020) applied to a two-state instead of
   lock/unlock pair: reopening only flips `status` back to `'draft'`; a subsequent approve overwrites the
   trio with fresh values. This gives "previously approved MM/DD/YYYY, currently reopened for correction"
   as a free read from existing columns, no new history table needed.
9. **No unique constraint on `(kind, meetingDate)`.** Two sets of minutes for one meeting (edge case,
   item 9) must be representable — a split or a re-do is a real scenario for a volunteer secretary. The
   "next meeting" pointer and "most recent approved minutes" queries resolve the ambiguity at read time
   (prefer `status='approved'` over `'draft'`; break remaining ties by most recent `approvedAt`/`createdAt`)
   rather than the schema forbidding the situation from existing.

**Rationale:** Every call either fills a gap the architect explicitly deferred to tech-lead (exact child-
table DDL, the email components-map file location) or resolves a real ambiguity the Phase 1/2 documents
didn't reach (mover/seconder structure level, the `MINUTES_KIND_EMAIL` policy shape, the member-hard-delete
interaction with attendance). None of it reopens a treasurer decision, DECISION-074, or DECISION-075.

**Impact:** Full detail in the Phase 3 section of `docs/work-log/2026-08-08-meeting-minutes.md`. Schema:
`minutes` (+ `title`), `minutesAttendance`, `minutesMotions`, `minutesActionItems` in `schema.ts`, migration
`0079_meeting_minutes.sql` (next free number as of 2026-08-09; database-admin confirms at implementation
time per DECISION-074's own numbering caution). Permission migration via the `add-permission` skill,
likely `0080` (confirmed at implementation time). New files `src/lib/minutes.ts`, `src/lib/minutes-queries.ts`,
`src/components/rich-markdown-content.tsx` (promoted), `src/components/admin/minutes/*`,
`src/components/minutes/*`, `src/app/(dashboard)/admin/minutes/*`, `src/app/members/records/*`. No new
npm dependency beyond the already-approved `turndown`/`turndown-plugin-gfm` (DECISION-074 Ruling 1);
`jsdom` explicitly NOT added.

---

## DECISION-076: Governance Document Versioning — sibling `documents`/`documentVersions` tables (not merged with minutes), `currentVersionId` pointer updated transactionally, no `kind` column for a corpus of one; `diff` (jsdiff) approved as a third new dependency, server-only (the inverse boundary of `turndown`); new `src/lib/documents.ts`/`documents-queries.ts` sibling pair; diff computed server-side, no client bundle impact, no size concern at 642 lines; seed is a one-off `scripts/*.ts` script, never a migration; git transcription file kept as a frozen historical artifact; `documents.manage` bound to `notetaker`/`admin`, pending substantive versions gated to `documents.manage` holders; `visibility` column (not route placement) expresses public-vs-members

**Status:** Resolved
**Date:** 2026-08-09

**Decision:** Phase 2 architectural ruling for
`docs/work-log/2026-08-09-governance-document-versioning.md`, split out of
`docs/work-log/2026-08-08-meeting-minutes.md` on 2026-08-09 once governance-document versioning grew
into a comparably-sized second feature. DECISION-074 and DECISION-075 stand exactly as written for
minutes — nothing below touches them.

1. **Two tables, `documents` and `documentVersions`, confirmed sibling-not-merged.** Minutes' real
   structure (attendance, motions, action items, kind-based email routing) and documents' real
   structure (an immutable version chain, `changeType` branching, adoption/citation) share no columns
   worth merging — doing so would reproduce, one level up, the same "bag of mutually-exclusive nullable
   columns" anti-pattern DECISION-072 already rejected once for `ledgerLetterTemplates` vs.
   `ledgerSettings`. The two systems share the *adoption pattern* as vocabulary
   (`approvedByUserId`/`approvedAt`/nullable minutes FK on one side, `adoptedByUserId`/`adoptedAt`/
   nullable `citingMinutesId` on the other), never a shared table. `documents` carries no `kind` column
   — the current inventory is one document, and a taxonomy for a corpus of one is the same
   premature-generalization trap already declined elsewhere in this feature's own Phase 1. "Current" is
   `documents.currentVersionId`, a pointer updated transactionally on every editorial save and on every
   adoption — never a computed `MAX(versionNumber)` or derived "latest adopted" query — so what a member
   sees is a single indexed lookup with no ambiguous in-between state.
2. **`diff` (jsdiff) is approved** — this feature's third new-dependency question, evaluated against the
   same five criteria `turndown` was, not waved through on precedent. Hand-rolling a line-level diff is
   not credible here for the same reason `turndown` wasn't hand-rolled: a well-understood algorithm
   (Myers/LCS) with real, named failure modes (off-by-one backtracking, trailing-newline handling,
   Unicode) whose entire job is to be the artifact the board trusts to show "exactly what changed" in a
   governing document — a correctness-critical, already-solved problem, not a reimplementation-for-its-
   own-sake. **Unlike `turndown`, `diff` must run server-only** — it has no DOM dependency (unlike
   `turndown`'s `DOMParser` requirement), so the architectural choice is to keep it out of every client
   bundle entirely: computed in a Server Component or server module, the resulting diff passed to any
   client wrapper as already-computed, serializable props. `diff` may never be imported from a
   `"use client"` file — the mirror image of `turndown`'s client-only rule, for the same underlying
   reason (a narrow, deliberate import boundary per dependency, not an accident of habit).
3. **New sibling pair `src/lib/documents.ts` (pure) / `src/lib/documents-queries.ts` (DB)**, the exact
   shape DECISION-074 Ruling 2 already established for minutes, applied on documents' own terms — not
   merged into `minutes.ts`/`minutes-queries.ts`, not joining the `ledger-*` family. `documents.ts` holds
   the `changeType`/`visibility` DECISION-041-pattern consts/validators and the pure
   `diffDocumentVersions()` helper (unit-testable without a DOM, `vitest.config.ts` runs
   `environment: "node"`). Admin compositions live in `src/components/admin/documents/`; member-facing
   read-side pieces in `src/components/documents/`. **Rendering reuses the promoted
   `rich-markdown-content.tsx` (DECISION-074 Ruling 2), never `ReleaseNotesViewer`'s `rehype-raw`-enabled
   pipeline** — an explicit correction, since Round 1's original by-laws plan reasoned from a
   git-authored trust boundary that Round 2 knowingly overturned; once versions are typed/pasted through
   an admin form, the trust tier is minutes'/budget-notes', not release notes'.
4. **Diff renders server-side; no practical size problem at this scale.** The seeded document (642
   lines / ~16 pages) diffs in millisecond order — no pagination/virtualization needed for the diff view
   at this size. A version-history list plus a compare view (default: this version vs. the one it
   superseded, but any two versions selectable) covers "how a member reviews history," computed
   server-side per request.
5. **The seed is a one-off `scripts/*.ts` script, never a migration.** This is the exact bug class that
   has already bitten this project for real — the standing memory note on the Ledger's Quicken-export
   seed ("NEVER re-run import — delete-and-reinsert wipes post-seed edits") is the concrete precedent a
   migration-based seed would risk repeating, since a `WHERE NOT EXISTS` guard protects against
   re-insertion but not against a human later re-running an edited migration file against a database
   where versions 2+ already exist on top of version 1. The script self-guards (no-op if the target
   `slug` already exists) as defense-in-depth, but its primary safety property is structural: it is not
   wired into `drizzle/migrations/` or any deploy step, so it cannot be silently re-triggered by a
   routine `pnpm build`/`db:migrate`. `docs/club-constitution-and-bylaws.md` stays committed as a frozen
   historical artifact (the human-reviewed-against-the-scan provenance record) but is never read by the
   app again after the one-time script runs — the database is authoritative from that point forward.
6. **`documents.manage` bound to `notetaker` and `admin`, no `documents.delete`** — confirmed, same
   module-separation reasoning as `minutes.manage` (no shared tables, and, per this ruling, not even a
   shared read-audience boundary). **A pending, not-yet-adopted substantive version is visible only to
   `documents.manage` holders until adoption** — ruled in, not left open: a pending version is a proposed
   amendment, not yet the club's actual text, and showing it indistinguishably from the adopted current
   version risks a member citing text that was never voted in. This is a principled divergence from
   minutes' "drafts visible to any member immediately" call, not an inconsistency — a minutes draft
   describes something that already happened (an imperfectly-transcribed meeting); a pending document
   version describes something that hasn't happened yet (a vote). **Public-vs-members visibility (B-38)
   is a `documents.visibility text NOT NULL` column** (DECISION-041 pattern), not route placement as
   Round 1 first proposed — Round 1's route-based idea was reasoned for a single static git-authored
   page with one reading surface; documents now has multiple reading surfaces (current view, history,
   diff) per row and must "express public without a rewrite" per the brief, which a column satisfies
   with a one-row update and a route-placement encoding does not. A pending substantive version is never
   public regardless of the document's `visibility` — the `documents.manage`-only gate applies on top of,
   not instead of, the document's general visibility.

**Rationale:** Every ruling either directly extends an already-resolved pattern in this codebase
(DECISION-072's rejection of merged mutually-exclusive-column tables; DECISION-041's no-CHECK taxonomy
pattern, applied here to `changeType`/`visibility`; DECISION-074's sibling pure/DB module split and
promoted-renderer reuse; the standing Ledger-seed memory note's cautionary precedent) or makes an
explicit, honestly-reasoned call where Phase 1 had flagged genuine ambiguity (`diff`'s server-only
boundary as the inverse of `turndown`'s client-only one; ruling the pending-version visibility question
in rather than leaving it open; `visibility` as a column once the by-laws' reading surface multiplied
beyond Round 1's single-page premise). Nothing here reopens a treasurer decision or DECISION-074/075's
settled minutes design.

**Impact:** New tables `documents`, `documentVersions` in `src/lib/db/schema.ts` + one idempotent
migration (exact number TBD at Phase 4 implementation time; `0078` is the highest on disk today, and
this migration must be sequenced after the not-yet-implemented `minutes` table exists, since
`documentVersions.citingMinutesId` references `minutes.id`). New files `src/lib/documents.ts`,
`src/lib/documents-queries.ts`. New component directories `src/components/admin/documents/`,
`src/components/documents/`. New npm dependency: `diff` (server-only import boundary enforced,
mirroring `turndown`'s client-only one). New `FEATURES` key `documents.manage` (no `documents.delete`),
bound to `notetaker`/`admin` via the `add-permission` skill. No changes to `minutes`/`minutes-queries.ts`
or the `minutes.manage`/`minutes.delete` keys. Full detail: Phase 2 section of
`docs/work-log/2026-08-09-governance-document-versioning.md`.

---

## DECISION-075: Meeting Minutes — email distribution addendum (companion to DECISION-074): `renderToStaticMarkup()` over the existing renderer for Markdown→HTML, no second dependency; a dedicated inline-styled email components map, not the web renderer's; partial `kind`→address map with no default and no save-block for unmapped kinds; address map co-located with `MINUTES_KINDS`, not a settings table; mandatory draft-status banner in the email body; `sendEmail()` reused unmodified; `CLUB_GROUP_EMAIL` exported for reuse

**Status:** Resolved (send-gating for draft club-wide minutes to `club@` left open — flagged for the treasurer, not decided here)
**Date:** 2026-08-08

**Decision:** The treasurer added post-save email-distribution requirements to
`docs/work-log/2026-08-08-meeting-minutes.md` after Phase 2 closed and before Phase 3 began: a
post-save prompt offering to email the minutes, board-kind → `board@westervillelions.org`,
general/club-kind → `club@westervillelions.org`, an optional sender note, and the minutes rendered
inline as HTML (no attachment). This decision rules on the resulting structural questions, appended to
the Phase 2 review as an addendum rather than a rewrite.

1. **`renderToStaticMarkup()` (from `react-dom/server`) over the DECISION-074 promoted renderer
   generates the email HTML — no new dependency.** It reuses the already-approved parsing engine
   (`remark-gfm` + the Markdown→AST→React pipeline) with a second, email-specific `components` map, in
   a server-only module (never a `"use client"` file). A parallel server-side remark/rehype string
   pipeline would duplicate capability already in the stack and was rejected on dependency-evaluation
   criterion 1 (already solved by an existing dependency). This is the feature's second
   new-dependency question; unlike `turndown` (a genuine capability gap), this one resolves to "not
   warranted."
2. **The email path gets its own inline-styled components map, not the web renderer's Tailwind-classed
   one.** Confirmed by reading this app's existing transactional email HTML
   (`api/contact/route.ts`, `api/auth/forgot-password/route.ts`, `api/suggestions/route.ts`,
   `lib/members.ts`): all plain HTML with light inline `style=` attributes, no classes — the existing
   house convention for mail, chosen because mail clients strip class-based CSS. The new
   `minutesEmailMarkdownComponents` map follows that convention; the web renderer's component map is
   not reused as-is for email.
3. **A `kind` with no address mapping gets no email prompt** — not a default address (a future
   committee-only kind silently defaulting to the whole-membership `club@` would be a real
   governance/privacy mistake) and not a block on saving (would re-couple "add a kind" to "resolve an
   address," defeating DECISION-074's no-migration-to-add-a-kind ruling). `MINUTES_KIND_EMAIL` is a
   partial map; an unmapped kind is fully usable, just not emailable, until a real address is added.
4. **Address mapping is a hardcoded const co-located with `MINUTES_KINDS` in `src/lib/minutes.ts`, not
   a `ledgerSettings`-style singleton table.** It changes at the same cadence, for the same reason, by
   the same actor as `kind` itself. Explicitly identified as the same open question Phase 1 already
   raised for `kind` (open question 3: hardcoded array vs. self-service table) — if promoted later,
   promote both together, not as two separate follow-ups.
5. **Draft-status disclosure is a required content rule, not a permission rule: any minutes email sent
   while `status != 'approved'` must carry an unmissable "DRAFT — subject to approval" banner.** This
   follows mechanically from an already-treasurer-settled fact (approval happens at the next meeting)
   and doesn't block the board's normal draft-review-by-email workflow. **Left explicitly open, not
   decided:** whether an unapproved general/club-kind draft may be emailed to `club@` (the whole
   membership) at all, or only board-kind drafts to `board@` pre-approval — a governance-policy call
   in the same register as the treasurer's earlier board-minutes-readability reversal, his to make.
6. **`sendEmail()` (`src/lib/email.ts`) is reused unmodified.** A Google Group address is an ordinary
   recipient from Resend's point of view; no changes needed. Its existing failure path
   (`{success, error}` returned synchronously after in-request retries; `status: 'failed'` persisted to
   `email_queue` with retry only via the admin-triggered `POST /api/admin/email-queue/retry` — confirmed
   no cron/scheduled job exists in this project) is correctly out of scope to change. New requirement:
   the post-save send action must surface `sendEmail()`'s result directly to the notetaker at the
   moment of the attempt, not a generic "saved" toast that implies the email went out regardless — a
   UI-plan requirement for Phase 3.
7. **The two addresses are not symmetric.** `club@westervillelions.org` is `CLUB_GROUP_EMAIL` in
   `src/lib/google-groups.ts` — already auto-synced by this app to every active member.
   `board@westervillelions.org` appears nowhere in that file — an external, presumably
   manually-managed group outside this app's sync surface. Doesn't change the send mechanism, but
   `CLUB_GROUP_EMAIL` should be exported (currently module-private) and imported into the new
   `MINUTES_KIND_EMAIL` map rather than re-typed as a second literal.

**Rationale:** Every ruling either directly extends an already-resolved DECISION-074 call (the
`kind`/no-migration principle governing the address map's shape; the `pendingDeleteAt`-style
"reuse the pattern, not blindly the behavior" discipline applied here to "reuse the renderer, not
blindly its styling") or grounds a new call in this codebase's already-observed conventions (existing
plain-HTML transactional email style; `sendEmail()`'s existing queue/retry contract). The one item left
open is left open deliberately — it is a governance policy question, not a structural one, and this
review has already established the precedent (DECISION-074's own citation of the board-minutes-readability
reversal) that such calls belong to the treasurer, not the architect.

**Impact:** No new npm dependency (second dependency question this feature raised, resolved "no").
`src/lib/minutes.ts` gains `MINUTES_KIND_EMAIL` next to `MINUTES_KINDS`. New email-only components map
for the promoted Markdown renderer (file location TBD by tech-lead — likely co-located with the
renderer or the new minutes-email-sending module). `src/lib/google-groups.ts`'s `CLUB_GROUP_EMAIL`
changes from module-private to exported. `src/lib/email.ts` unchanged. One open question carried into
Phase 3 for the treasurer: may an unapproved draft of a club-wide (general) minutes record be emailed
to `club@` at all, or only board-kind drafts to `board@` pre-approval?

---

## DECISION-074: Meeting Minutes — `turndown` approved (client-only, single line-item); new `minutes.ts`/`minutes-queries.ts` sibling pair kept out of the `ledger-*` module family; shared Markdown renderer promoted (not cloned) out of `budget-notes-markdown.tsx`; Dues/Reimbursements/Impact/Financial-Reports routes preserved (navigation-only regroup); `meetingDate` is `date` not `timestamp`; attendance keys on `members`, not `users`; new `notetaker` role + `minutes.manage`/`minutes.delete` features

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-08-08-meeting-minutes.md`, closing
the six structural questions the Phase 1 doc (READY WITH NOTES, revised per treasurer feedback) left
open for the architect.

1. **`turndown` (+ `turndown-plugin-gfm`) is approved as a new dependency**, evaluated against the
   no-dependency alternative honestly rather than rubber-stamping the analyst's recommendation:
   hand-rolling Word-HTML-to-Markdown conversion means re-implementing, untested, exactly what
   Turndown already does well. It clears the dependency-evaluation criteria cleanly — not solved by
   anything in `package.json` (no HTML→Markdown capability exists there today), MIT-licensed,
   long-stable — and its defining property is that it **can only run client-side** (built on the
   browser's `DOMParser`), which is stricter than "nice to have": it is now a hard rule that
   `turndown`/`turndown-plugin-gfm` may only be imported from a `"use client"` file (the admin minutes
   paste-handler), never a route handler or server action. Bundle impact is contained to that one
   admin-only route chunk via Next's per-route code-splitting — the public-site/member-portal-read-side
   bundle is untouched. One implementation-level gap flagged for Phase 3's edge-cases list, not a
   dependency concern: Turndown alone doesn't specifically un-fake Word's `mso-list` pseudo-bullets;
   that needs a small Word-specific DOM pre-clean pass in code, not another dependency.
2. **Two new top-level sibling modules, `src/lib/minutes.ts` (pure) / `src/lib/minutes-queries.ts`
   (DB)** — generalizing the Ledger's pure/DB split to a new domain, but deliberately **not** joining
   the `ledger-*` module family (DECISION-049/062/065/069/072 lineage): minutes shares no tables, no
   permission keys, and no audience boundary with the Ledger, and prefixing it `ledger-*` would
   misrepresent it as a Ledger sub-feature. Search (`searchMinutes()`) stays inside
   `minutes-queries.ts` rather than pre-emptively splitting a `minutes-search-queries.ts` sibling —
   the lineage's *reasoning* (split when the parent gets oversized) doesn't yet apply to a module
   starting at zero lines. Search uses `ILIKE`, no full-text index — directly consistent with
   `ledger-search-queries.ts`'s own "sequential ILIKE scans are cheap at this club's data volume"
   ruling at comparable-or-larger record volume (minutes: ~30/year).
3. **The Markdown renderer is promoted out of `budget-notes-markdown.tsx` into a new neutral top-level
   component** (e.g. `src/components/rich-markdown-content.tsx`), not cloned. Cloning would create two
   near-identical ~90-line renderers with two places to fix a bug or extend the element set — already
   a live smell, since `markdown-content.tsx` and `budget-notes-markdown.tsx` are two overlapping
   renderers today (flagged for the next 30-day code review, not fixed here). The promoted component's
   two existing call sites (`budget-notes-editor.tsx`, `budget-print-worksheet.tsx`) get their imports
   updated; minutes imports the same component. `markdown-content.tsx` is left untouched — it has real,
   different callers (event descriptions) using its simpler element set, and conflating the two risks
   bleeding table/print styling into plain event prose. The "never `rehype-raw`" comment travels with
   the promoted file verbatim. Whether the promoted component still needs `"use client"` (the original
   has no hooks/state/handlers — may be inherited convention, not necessity) is left for Phase 3 to
   actually check rather than copy blindly.
4. **IA restructure is navigation-only — no route moves.** `/members/dues`, `/members/reimbursements`,
   `/members/impact`, and `/members/financial-reports` keep resolving exactly as they do today; "Profile
   absorbs Dues/Reimbursements" and "Club Finances absorbs Impact/Financial-Reports" are entry-point
   changes at `/members/page.tsx` only, both hubs fanning out to unchanged underlying pages — the same
   shape `ADMIN_NAVIGATION`'s "Treasury" group already establishes. This applies one consistent
   resolution to two structurally identical "hub absorbs sub-pages" moves (Phase 1 had already implied
   this for Club Finances but left Profile's wording more ambiguous about route fate). Avoids breaking
   bookmarks, emailed links, and browser history; a tabbed Profile UI must still resolve to the real
   underlying routes, not a route merge.
5. **Two data-model type calls, settled now rather than picked arbitrarily in Phase 3:** `minutes.meetingDate`
   is a `date` column, not `timestamp` — directly following DECISION-001's reasoning (occurrence-keyed
   data uses `date` to sidestep timezone ambiguity), explicitly **not** copying `eventRsvps.occurrenceDate`'s
   naive-timestamp pattern, which DECISION-001 itself already named as the known project bug. And
   `minutesAttendance.memberId` references `members`, not `users` — attendance is a notetaker-checked
   roster of known club members (per Phase 1's Flow 2), the same table Directory/Dues already key off
   of, unlike `eventRsvps.userId` which must support anonymous/any-signed-in-account RSVPs.
6. **No schema change to the three `boardMinute` free-text fields** (`ledgerTransactions.boardMinute`,
   `ledgerBudgetApprovals.boardMinute`, `ledgerReimbursements.boardMinute`) in this pass — concurring
   with the analyst's Out-of-Scope call. `minutes.id` being a standard stable `uuid` PK is already
   sufficient to keep a future nullable `boardMinutesId` FK a clean additive migration; nothing further
   needs to be shaped now.
7. **Permissions:** two new `FEATURES` keys, `minutes.manage` (create/edit any kind/status, approve,
   reopen) and `minutes.delete` (soft-delete/restore, admin-only), plus new role `notetaker`. Follows
   the `budget_committee`/DECISION-069 migration shape exactly — idempotent `INSERT ... WHERE NOT
   EXISTS` for the features, the role, and each `role_features` bind, with `admin` explicitly bound to
   both keys per that migration's own stated convention. No `minutes.view`/read gate — reading any
   minutes, any kind, any status, is intentionally ungated per the treasurer's explicit call, not
   reintroduced "for symmetry." `pendingDeleteAt` column shape is reused from `ledgerBudgets`; its
   purge-on-finalize *behavior* is explicitly not — minutes never auto-purges, matching nonprofit
   permanent-retention practice the analyst's Phase 1 research already established.

**Rationale:** Every ruling either reuses an already-established pattern in this codebase (DECISION-001's
date-column reasoning, DECISION-041's no-CHECK taxonomy pattern, DECISION-069's role-binding migration
shape, the Ledger's pure/DB module split, `ADMIN_NAVIGATION`'s hub-fan-out precedent) or makes an
explicit, honestly-reasoned call where no precedent existed (the `turndown` dependency gate; promote-
not-clone for the renderer; `members` not `users` for attendance). Nothing here re-litigates a treasurer
decision or a Phase 1 recommendation already backed by real research — the six items were genuinely
undecided structural questions, not disagreements.

**Impact:** New tables `minutes`, `minutesAttendance`, `minutesMotions`, `minutesActionItems` in
`schema.ts` + one idempotent migration (exact number TBD at Phase 4 — `0076` is reserved in-narrative
by the concurrently in-flight DECISION-072 work but not yet on disk, `0077` already exists). New files
`src/lib/minutes.ts`, `src/lib/minutes-queries.ts`. New component directories
`src/components/admin/minutes/`, `src/components/minutes/`. `src/components/admin/ledger/budget-notes-markdown.tsx`
relocated to a new top-level neutral name with two import-site updates. New npm dependency: `turndown`
+ `turndown-plugin-gfm` (client-only import boundary enforced). New `FEATURES` keys `minutes.manage`/
`minutes.delete`, new role `notetaker`, migration via the `add-permission` skill. `src/app/members/page.tsx`
tile grid changes from 8 tiles to 6; no existing member-portal routes are removed or moved.

---

## DECISION-073: Acknowledgment Letter Generation — Phase 3 implementation calls: added `ledgerAcknowledgments.quidProQuoDescription` column (Pub. 1771 requires a description of goods/services, not just FMV); regenerate allowed freely pre-`sentAt`, hard-refused post-`sentAt`; generate route writes directly (no separate preview endpoint) since pre-send regeneration already covers the review step; threshold guard stays solely at ack-creation time, not re-derived at generation time; new purpose-built `listGeneratableAcknowledgments()` read instead of extending `listPendingAcknowledgments()`; reuse `BudgetNotesMarkdown` for letter rendering instead of a new renderer

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** Phase 3 technical-design calls for
`docs/work-log/2026-08-08-acknowledgment-letter-generation.md`, filling in the content-level details
DECISION-072 (architect) deliberately left to tech-lead.

1. **New nullable column `ledger_acknowledgments.quid_pro_quo_description`** (migration
   `0078_ledger_ack_quid_pro_quo_description.sql` — `0077` is already claimed by the concurrently
   in-flight, unrelated `docs/work-log/2026-08-08-donor-multiple-emails.md`). Pub. 1771's
   quid-pro-quo disclosure requires a *description* of the goods/services provided, not just their
   fair-market value — `quidProQuoValueCents` alone (the only field that existed) can't name what a
   donor actually received (e.g. "a Rudolph Run 5K entry"), so the composed letter could only say
   "goods or services" generically. This wasn't named in DECISION-072's stated impact; flagged here
   explicitly as a scope addition rather than silently expanded. `AcknowledgeDialog` gets one new
   optional field to capture it; the composer falls back to the generic phrase when null (legacy
   rows), never blocking generation on its absence.
2. **Regenerate is allowed, freely, until `sentAt` is set; refused entirely after.** Reconciles Phase
   1's "preview then Save" flow with Phase 2's ruling that the generate route writes directly (no
   separate preview endpoint): since a not-yet-sent ack's `letter_text` can be safely overwritten any
   number of times, clicking "Generate" IS the review step — the treasurer edits the template or
   donor record and regenerates until it looks right, then marks it sent. After `sentAt` is set,
   generation hard-refuses (`skipped: "already sent"`) rather than silently overwriting the
   historical record of what was actually mailed — mirrors `amountCents`'s DECISION-026 immutability.
3. **The below-$250/$75 threshold guard is NOT re-checked at generation time.** It already lives at
   ack-*creation* time (`POST .../acknowledge` already requires `deriveAckType()` non-null unless a
   treasurer supplies `typeOverride`). Re-deriving and rejecting on mismatch at generation time would
   create a second decision point that could reject a legitimate manual override, directly against
   DECISION-072 §3's "exactly one place decides the ack type" invariant. Generation only enum-checks
   that `ack.type` is one of the two known values (corrupted-row defense, not a second threshold
   policy). The `ackNotRequired` category guard, by contrast, IS re-checked fresh at generation time
   (via a JOIN, not inherited from queue membership) — the two guards sit at different points
   deliberately, not inconsistently: one is a stable per-row fact set once at creation, the other can
   change after the ack row already exists (a category's flag can be toggled later).
4. **New `listGeneratableAcknowledgments()` in the new `ledger-acknowledgment-letter-queries.ts`
   module, not an extension of `listPendingAcknowledgments()`.** The existing pending-queue query
   (`ledger-queries.ts:4976`) doesn't select the fields this feature needs (`type`,
   `quidProQuoValueCents`, `quidProQuoDescription`) and is a live dependency of `AckQueue` today —
   extending it risks regressing that screen. A purpose-built read carries zero blast radius to the
   existing queue.
5. **Reuse `BudgetNotesMarkdown` (`src/components/admin/ledger/budget-notes-markdown.tsx`) to render
   composed letter text**, rather than writing a second Markdown-rendering component. It's already a
   generic, budget-agnostic renderer (react-markdown + remark-gfm, deliberately no raw-HTML
   passthrough) — this is a real second caller appearing, the exact trigger DECISION-065's
   generalize-on-second-need discipline calls for, not a case of building ahead of need. Only its doc
   comment needs a one-line update naming the second consumer; ux-developer's call whether a rename
   is also worth it.

**Rationale:** Each call above resolves a genuine tension left open by Phase 1/Phase 2 (preview-vs-
write-directly; how precise vs. how conservative to be about Pub. 1771's actual required content;
which existing query/component to extend vs. leave alone) using the same discipline already applied
elsewhere in this codebase — reuse over duplication, but only once a real second need exists, and
flag scope additions explicitly rather than quietly expanding them.

**Impact:** Second migration `0078_ledger_ack_quid_pro_quo_description.sql` alongside DECISION-072's
`0076_ledger_letter_templates.sql`. One new field on `AcknowledgeDialog`. No new rendering component
(reuses `BudgetNotesMarkdown`). Full detail: Phase 3 section of
`docs/work-log/2026-08-08-acknowledgment-letter-generation.md`.

---

## DECISION-072: Acknowledgment Letter Generation — new singleton `ledger_letter_templates` table with named editable slots only (required IRS block generated in code, unreachable from the template's writable surface); new `ledger-acknowledgment-letter-queries.ts` + pure `ledger-acknowledgment-letter.ts` sibling modules; one batch-capable generate route; print reuses the existing `print:hidden`/`break-before-page` pattern; template edits audited via the existing `ledger_audit_log` table with no schema change

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** Phase 2 architectural ruling for
`docs/work-log/2026-08-08-acknowledgment-letter-generation.md`, closing the seven structural
questions Phase 1/the treasurer's brief left open.

1. **New table `ledgerLetterTemplates` (`ledger_letter_templates`), singleton row**, following
   `ledgerSettings`' existing singleton pattern exactly (same seed idiom:
   `INSERT ... SELECT ... WHERE NOT EXISTS`, `drizzle/migrations/0044_ledger_books.sql:352-360`) —
   not a column on `ledgerSettings` (a bag of unrelated scalar knobs, wrong axis for structured
   content) and not a per-type or per-entity table (Treasurer Decision: one shell, ack-type-adaptive).
   Columns are named editable slots (`greeting`, `bodyText`, `closing`, `signatureName`,
   `signatureTitle`) plus `updatedByUserId`/`updatedAt`. No version-history table — `letter_text` on
   `ledger_acknowledgments` already snapshots the merged result per letter (DECISION-026 lineage);
   template version history is a distinct, unrequested feature, deferred until a real second need
   appears (same discipline DECISION-065 already applied to this exact audit table).
2. **Generated structure + editable text is modelled as named slots on the template plus a fixed
   skeleton in a pure composer function, `composeAcknowledgmentLetter()`** — not free text with
   required substrings. The template's five columns are the entire allowlist its edit endpoint
   accepts; there is no field anywhere the required statement (entity name, EIN, amount, date,
   no-goods-or-services / quid-pro-quo FMV statement) could be typed or deleted, because that text is
   never treasurer-authored — it's generated fresh from `ack.type`/`entity`/`ack` data by an unexported
   helper the template's write path cannot reach. This makes a legally deficient letter structurally
   unreachable, not merely validated, per the Carried-forward invariant.
3. **Two new sibling modules**, continuing the DECISION-049/061/062/065/069 lineage:
   `src/lib/ledger-acknowledgment-letter-queries.ts` (DB reads/writes — template CRUD +
   `generateAcknowledgmentLetters()`), kept out of the already-oversized `ledger-queries.ts`
   (5,182 lines) and out of the unrelated `ledger-category-queries.ts`; and
   `src/lib/ledger-acknowledgment-letter.ts` (pure, DB-independent, unit-testable without a DOM —
   `vitest.config.ts` runs `environment: "node"`), holding `composeAcknowledgmentLetter()`. The pure
   module imports `deriveAckType`'s already-derived `ack.type` rather than re-deriving it, keeping
   exactly one place in the codebase (`lib/ledger.ts`) that decides `written_ack_250` vs
   `quid_pro_quo_75`.
4. **One route, plural ids**: `POST /api/admin/ledger/acknowledgments/letters/generate`, body
   `{ ackIds: string[] }`. Mirrors `POST /api/admin/ledger/budgets/seed`'s existing precedent:
   deterministic pre-validation per row (donor linked, donor has an address, category still passes
   `listPendingAcknowledgments()`'s existing filter predicate — not a second exclusion list) classifies
   each id as `generated` or `skipped: <reason>` before any write; only passing rows are written, all
   inside one `db.transaction()`. Single-letter generation is the same endpoint called with a one-item
   array — no second implementation to drift out of sync with batch skip logic.
5. **No new print route.** Reuses the exact pattern already established in
   `admin/ledger/budgeting/page.tsx`: an interactive `print:hidden` region alongside an unconditionally
   mounted print-only component, toggled by the print stylesheet rather than React state. A new
   `AcknowledgmentLettersPrint` component renders one `<section>` per letter with `break-before-page`
   on every section after the first — the same Tailwind print utility `budget-print-worksheet.tsx:333`
   already uses. Covers both single-letter preview/print (a selection of one) and batch print (a
   selection of many) with one component.
6. **No new npm dependency.** No templating library (a handful of named-slot substitutions, not
   user-authored logic); no PDF library (locked precedent, reused verbatim).
7. **Invariants:** no new `FEATURES` key — generate/preview/deliver stays on `LEDGER_RECORD` (same
   gate as `AcknowledgeDialog`/`MarkSentDialog`); club-wide template edits are gated `LEDGER_MANAGE`,
   ruled in now rather than left open, since it's a direct application of the existing blast-radius
   bar `LEDGER_MANAGE` already sets for funds/categories/entities/settings, not a new judgment call.
   Template edits are audited through the **existing** `ledger_audit_log` table with **no schema
   change** — its nullable `targetCategoryId` is left `null` (nothing to point at; there's one
   template row) and its generic `before`/`after`/`details` columns already hold arbitrary JSON diffs,
   exactly the shape DECISION-065's own comment anticipated a future non-category caller would use.
   New idempotent migration `0076_ledger_letter_templates.sql`, no SQL-level ordering dependency on
   `0075_ledger_category_ack_not_required.sql` (different table); the deploy-timing dependency between
   the two (0075 must have actually run in production before this feature ships, per the treasurer's
   carried-forward sequencing note) is flagged as a pre-push/qa checklist item for this feature, not a
   migration-ordering concern.

**Rationale:** Every ruling reuses an already-established pattern in this codebase (singleton-
settings shape, sibling-module split, `print:hidden`/`break-before-page` print convention, the
generalized `ledger_audit_log` table, `budgets/seed`'s pre-validate-then-transact batch shape) rather
than inventing a new one. The one genuinely new design decision — modelling the compliance boundary as
named slots a pure composer function assembles, instead of free text with required substrings — is the
Phase 1 recommendation made concrete at the schema/function-signature level, which is what makes an
edit that produces a legally deficient letter a non-existent code path rather than a validation
someone could get wrong.

**Impact:** New table `ledgerLetterTemplates` in `schema.ts` + `drizzle/migrations/0076_ledger_letter_templates.sql`.
New files `src/lib/ledger-acknowledgment-letter-queries.ts`, `src/lib/ledger-acknowledgment-letter.ts`.
New route `src/app/api/admin/ledger/acknowledgments/letters/generate/route.ts` (+ a template CRUD
route). New components under `src/components/admin/ledger/` (template editor, generate dialog,
`AcknowledgmentLettersPrint`). No new `FEATURES` key (existing `LEDGER_RECORD`/`LEDGER_MANAGE` reused).
No new npm dependency. Full detail: Phase 2 section of
`docs/work-log/2026-08-08-acknowledgment-letter-generation.md`.

---

## DECISION-071: Ack Not Required category flag — UI-gated, not server-blocked; not exposed at category creation

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** `ledger_categories.ack_not_required` (docs/work-log/2026-08-08-ack-not-required-flag.md) has no
server-side restriction on which category it can be set on — the PATCH route accepts it on any category, income or
expense, either entity. The admin UI (`CategoryFlagsDialog`) only *offers* the checkbox for an income category on a
donations-deductible entity (Foundation today), because that's the only combination `listPendingAcknowledgments()`
(`ledger-queries.ts`) ever checks the flag against. Also not added to `CategoryCreateDialog` (unlike `countsAsGiving`,
which that dialog does expose at creation time).

**Rationale:** Setting the flag on an expense category or a non-deductible entity's category is inert, not harmful —
`listPendingAcknowledgments()`'s own WHERE clause already scopes to `donationsDeductible = true AND flow = 'income'`
before the flag is ever consulted, so a stray `true` elsewhere can never suppress an acknowledgment that would
otherwise fire. Adding a server-side block would duplicate that scoping logic in two places for a category that
can't do anything wrong. Skipping category-creation exposure: this flag names five specific, already-existing,
recurring categories (race-entry fees, event receipts, pooled fundraiser deposits, grants, an internal transfer) —
a genuinely rare exception, not a routine creation-time decision the way giving-vs-overhead (`countsAsGiving`) is.

**Impact:** `CategoryFlagsDialog` conditionally renders the checkbox on `category.flow === "income" &&
entityDonationsDeductible`; `EntityCategoryData.donationsDeductible` (new field) carries that down from the Server
Component page. `CategoryUpdatePatch.ackNotRequired` and the PATCH route's validation are otherwise symmetric with
`countsAsGiving`'s handling, minus the `ConfirmDialog`/dollar-impact step — the flag has no public-facing or
retroactive-dollar-total effect (it only changes what's queued in the internal Acknowledgments list), so it saves
plainly alongside `form990Line`.

---

## DECISION-070: Budget Context on Transaction Entry — Phase 3 implementation calls: `resolveDisplayBudgetCents` reused for the null-vs-zero budget convention, FY-switch handled by comparing payload FY to derived FY (not a loading boolean), amber-only over-budget styling reused from `budget-overview-table.tsx`'s `StatCell`, reimbursement dialog confirmed out of scope

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** Phase 3 technical design for `docs/work-log/2026-08-08-budget-context-on-transaction-entry.md`, executing
DECISION-069's rulings. Five implementation-level calls, each within DECISION-069's architecture rather than reopening it:

1. **Null-vs-zero budget convention:** `getBudgetContext()` applies `resolveDisplayBudgetCents()` (`lib/ledger.ts:2077`)
   to every category row, exactly as `getFundReport()` already does — a starred/noted `$0` annotation-only row reads as
   `budgetCents: null` ("no budget set"), not a fabricated `$0`. Reuses the existing convention Phase 2 flagged rather
   than inventing a second null-vs-zero rule for this one payload.
2. **FY-boundary refetch race:** the panel doesn't gate its Loading state on a `fetchInFlight` boolean (which can lag
   one render behind a fast prop change). It compares the fetched payload's own `fiscalYear` field to the current
   `derivedFiscalYear` prop and renders Loading whenever they disagree, plus discards any response whose requested FY
   no longer matches `derivedFiscalYear` at resolution time. This is the concrete fix for Phase 1's single
   highest-consequence risk (Flow 3, back-dating across a FY boundary) — a boolean flag alone doesn't cover the
   out-of-order-response race a slow-then-fast pair of fetches can produce.
3. **Over-budget styling:** reuses the existing `text-amber-700` "warn" treatment `budget-overview-table.tsx`'s
   `StatCell` (line 139) already uses for a negative `Net` figure, rather than introducing a new color. Applied only to
   the expense framing — explicitly never applied when income exceeds its expected figure, since exceeding an income
   budget is good news (treasurer decision #4), not a risk signal.
4. **No shared FY-parse helper extracted.** The 4-line `getFiscalYear(new Date(txnDate + "T00:00:00"))` parse is now
   duplicated a third time (`transaction-form.tsx`, `budget-line-picker.tsx`, `budget-context-panel.tsx`). Left
   un-extracted deliberately — it was already duplicated twice without complaint, and a third inline copy is more
   honest than a one-line-saving abstraction three call sites deep. Revisit only if a fourth call site appears.
5. **Reimbursement mark-paid dialog (`pay-reimbursement-dialog.tsx`) confirmed OUT OF SCOPE** for this increment, per
   Phase 1's own recommendation, not overridden by the treasurer's 2026-08-08 decisions. `BudgetContextPanel`'s prop
   shape is generic enough to wire in later as a small follow-up (the reimbursement dialog's `amount` is currently a
   fixed, non-editable string, so the projected-figure UX needs a small adjustment there first).

**Rationale:** Each call reuses an existing pattern already proven in this exact codebase (the annotation-only budget
convention, the `StatCell` warn color, the effect-dependency-vs-payload-comparison staleness guard style already implicit
in other fetch-effect components) rather than inventing a new one, keeping this feature's failure modes — and its visual
language — consistent with the rest of The Ledger.

**Impact:** No new files beyond what DECISION-069 already named. Full contract, panel states, and named unit tests are in
`docs/work-log/2026-08-08-budget-context-on-transaction-entry.md`'s Phase 3 section. Implementer split: api-developer
(query module + route) → ux-developer (panel + form integration).

---

## DECISION-069: Budget Context on Transaction Entry — new `ledger-budget-context-queries.ts` sibling module; fetch scoped to `(fundId, derived fiscal year)` via a client-fetched route handler, not per-category-selection and not whole-entity-across-all-FYs; posted/pending both returned as separate labeled fields, never a silent toggle

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-08-08-budget-context-on-transaction-entry.md`, closing the five structural questions Phase 1 left open.

1. **Fetch strategy: neither of the two extremes Phase 1 flagged.** Not "preload the whole entity across every fiscal year it has ever budgeted" (that's `getBudgetLineOptions()`'s existing shape for static line *metadata*, but actuals are live data that changes on every posted/pending transaction — preloading every historical FY multiplies cost for years the treasurer isn't entering against). Not "fetch per category/line selection" either — Phase 1 confirmed zero precedent for that anywhere in this form. The right grain is **`(fundId, fiscalYear-derived-from-txnDate)`**: one request returns every category's and every budget line's budgeted/used figures for that one fund+FY slice, and the category/budget-line pickers keep doing what they already do — filtering a preloaded set client-side with no further round trip. A `useEffect` in the new panel component depends on `[fundId, derivedFiscalYear]` (the *derived* FY, not raw `txnDate` — so editing the day-of-month within the same fiscal year never refetches), matching the dependency shape `transaction-form.tsx`'s existing `budgetLineId` auto-clear effect (line 284) already uses for the same date-crosses-FY-boundary case. This also answers Flow 4 (edit mode): the effect fires on mount using `initialValues`' already-set `fundId`/`txnDate`, same as every other effect in this file.
2. **New sibling module, `src/lib/ledger-budget-context-queries.ts`**, not an extension of `getFundReport()` and not a new call site inside `ledger-queries.ts` (already the largest file in `src/lib`). Mirrors the precedent `financial-report-queries.ts` (DECISION-049), `ledger-search-queries.ts` (DECISION-062), and `ledger-category-queries.ts` (DECISION-065) all set: a distinct, narrower read surface composing the existing pure-arithmetic engine in `lib/ledger.ts`, not a rework of `getFundReport()`. `getFundReport()` is not reused directly as the data source because it computes several things this feature doesn't need (fund-wide rollforward, an extra categories query, the full posted-only cause-actuals pool) and is missing the one thing this feature does need (a per-category/per-line *pending* breakdown — `getFundReport()` only ever surfaces `pendingExpenseCents` as a single fund-wide total, never broken out by category). The new module owns exactly one exported query, scoped to `(fundId, fiscalYear)`, returning budgeted/posted/pending figures per category and per budget line in that slice.
3. **Reuse `lib/ledger.ts`'s existing pure helpers rather than a fourth implementation of budget-vs-actual arithmetic.** The new query imports and reuses `resolveCauseLineActual`, `causeLineReferenceKey`, `isEligibleForFuzzyCauseMatch`, and `buildCauseActualsByKey` for cause-line-grain actuals — becoming a third consumer of `resolveCauseLineActual` alongside `getFundReport()` and `computeOneMonthCashActuals()`, exactly the pattern its own doc comment anticipates ("Called once per cause line by every consumer"). The category-grain budgeted/remaining figure reuses `budgetVariance()` unchanged. `lib/ledger.ts` has no DB import and is already client-safe (confirmed: only imports `getFiscalYear` from `fiscal-year.ts`), so the same `budgetVariance()` call is reused again, client-side, for the "projected after this transaction" figure — one function computing that arithmetic everywhere it's computed, not a client-side reimplementation. This is the concrete mechanism that keeps this feature's numbers from drifting out of agreement with the fiscal report and the admin fund report: the *posted* half of this feature's figure and `getFundReport()`'s figure are required to share the identical `status === 'posted'` predicate and the identical grouping/resolution helpers, not just "an equivalent computation."
4. **Posted vs. pending is expressed as two separate, explicitly labeled fields on every returned row — not a boolean `opts` toggle and not two call sites.** The new query always computes and returns both `postedCents` and `pendingCents` per category/line (this feature is the only consumer today; there's no second call site to diverge from). A labeled dual-figure return is self-documenting at the type level — a future posted-only caller reads `postedCents` and ignores `pendingCents` without needing to know a flag existed — and it directly satisfies the treasurer's requirement that the UI label what it counts, since the component has both numbers in hand rather than one pre-collapsed sum.
5. **Server/client split:** a new `GET /api/admin/ledger/budget-context` route handler (Node runtime, `auth()` + `hasFeature(BUDGET_VIEW) || hasFeature(LEDGER_MANAGE)`, per the treasurer's explicit gate) calls the new query and returns JSON. A new client component, `src/components/admin/ledger/budget-context-panel.tsx` (`'use client'`), owns its own fetch effect keyed on `[fundId, derivedFiscalYear]`, receives `categoryId`/`budgetLineId`/`flow`/`amount` as props from `transaction-form.tsx`, and does the "current vs. projected" and received-vs-expected arithmetic locally against the fetched baseline — pure client computation, no additional fetch per keystroke. This is the first client-side `fetch()` inside `transaction-form.tsx` itself, but not a new pattern for this *directory* — `category-merge-dialog.tsx`, `budget-cause-editor.tsx`, and several other client components under `src/components/admin/ledger/` already fetch their own route handlers on demand; this feature follows that existing convention rather than inventing a new one. `TransactionFormDialog`/`TransactionForm`'s existing preloaded-props pattern for `categories`/`budgetLines` is untouched — this is additive, not a replacement.
6. **No new dependency.** Confirmed against the dependency-evaluation criteria: this is arithmetic on data already in Postgres via Drizzle, rendered with existing Tailwind/shadcn primitives. Follows the strong prior stated in the brief.

**Rationale:** Every ruling favors the shape that keeps exactly one code path per concern (one query module for this grain, one shared arithmetic library reused three-plus times, one labeled response shape for posted/pending) over a shape that would require either a heavier whole-entity fetch, a second independent arithmetic implementation, or a hidden mode flag — consistent with the DECISION-049/061/062/065 lineage this feature explicitly continues.

**Impact:** New file `src/lib/ledger-budget-context-queries.ts` (query + types). New file `src/app/api/admin/ledger/budget-context/route.ts`. New file `src/components/admin/ledger/budget-context-panel.tsx`. Modified: `src/components/admin/ledger/transaction-form.tsx` (renders the new panel, passes props, first client-fetch in this file). No schema changes, no new `FEATURES` key (existing `BUDGET_VIEW`/`LEDGER_MANAGE` reused per the treasurer's explicit gating call). Full component wiring and the API contract are Phase 3's to lock.

---

## DECISION-068: Ledger Category Management — merge now ALSO refuses the whole operation when any affected fiscal year is EARLIER than the current fiscal year, regardless of lock status; the lock-based guard from DECISION-067 was necessary but not sufficient

**Status:** Resolved
**Date:** 2026-08-08

**Decision:** DECISION-067's whole-merge, lock-based refusal is a correct implementation of
what it says, but the Phase 6 re-check (`docs/work-log/2026-08-07-ledger-category-management.md`,
"Phase 6 Re-Check (loop-back)") found it doesn't actually restore the boundary it was written to
restore. Tracing the real `Awards` → `Member recognition` merge concretely against the live dev
DB: `Awards` carries exactly one budget row, FY2025, and **no fiscal year has ever actually been
locked** for either entity — every `ledger_budget_approvals` row on record is a QA e2e artifact,
all `unlocked`, and Club FY2025 has no approval row at all. Because DECISION-067's guard triggers
only on `status = 'locked'`, that merge would proceed today, silently re-pointing FY2025's
approved budget row — exactly what `scripts/merge-club-budget-categories.ts`'s own header comment
refused to do ("would falsify the historical record") and exactly what DECISION-067 was written to
prevent. The guard is a correct reading of DECISION-067's literal text; it does not restore the
precedent script's actual boundary, which was **fiscal-year scope**, not lock status.

New rule, effective now, checked in `mergeCategories()` **before** the existing locked-year check
(both checks remain; this one runs first because it doesn't depend on anyone having remembered to
lock a closed year — in practice, nobody ever has): **merge refuses the whole operation, naming
the prior fiscal year(s), whenever ANY fiscal year it would re-point is earlier than the current
fiscal year** — derived from the existing `currentFiscalYear(new Date())` helper in
`src/lib/fiscal-year.ts` (never hardcoded). This is a whole-merge refusal, same discipline as
DECISION-067's lock-based one: not a partial merge that quietly skips the prior year and proceeds
for the rest. The treasurer's own framing: a merge moves a budgeted *amount*, and a prior fiscal
year's budget is already closed — the club shouldn't quietly restate it, and that correctness
shouldn't depend on locking discipline nobody has practised.

One concrete, known, and *intended* consequence: `Awards` now has only its FY2025 row left (its
FY2026 row was already merged by an earlier script), so merging `Awards` → `Member recognition`
through the UI is now refused outright — there is nothing left in `Awards` to merge in the current
fiscal year. The merge dialog (`category-merge-dialog.tsx`) and the refusal message itself say so
plainly (distinct wording from the locked-year refusal, since the reasons differ), so a treasurer
reads this as "nothing to do here, and the old row is safe as approved" rather than a bug.

**Rationale:** A guard that depends on a manual, easy-to-skip action (locking a fiscal year) that
has never actually been performed in this database's real history is not a safety guarantee, it's
a policy statement that happens to have zero live enforcement. The treasurer's actual intent — do
not quietly restate a budget the club has already closed out — is better and more simply
guaranteed by comparing the fiscal year directly to the one everyone already treats as "current"
(the same `currentFiscalYear()` helper every other Ledger surface uses), independent of whether
anyone remembered to run Approve & Lock for that year. Keeping the lock-based check alongside this
one (rather than replacing it) still matters: a future or current-year budget row can be locked for
reasons unrelated to being prior (e.g. a current-year approval the board has already signed off
on), and that case is still correctly blocked by DECISION-067's check.

**Impact:** `src/lib/ledger-category-queries.ts` (`mergeCategories()` gains a new refusal step,
inserted immediately after the both-sides-budget-collision check and before the existing
locked-year check — filters the computed `plan[]` for any `fiscalYear < currentFY` and refuses the
whole call, for both `confirm:false` and `confirm:true`, naming every prior year with correct
singular/plural grammar; module and function doc comments updated). `src/app/api/admin/ledger/categories/merge/route.ts`
(doc comment gains the new refusal step, renumbering the locked-year step from 8 to 9).
`src/lib/ledger-category-ui.ts` (new pure helper `isPriorFiscalYearMergeRefusal()`, unit-tested in
`ledger-category-ui.test.ts`). `src/components/admin/ledger/category-merge-dialog.tsx` (top doc
comment, `Dialog.Description` copy, and a non-alarming presentation for this specific refusal —
"Nothing to merge in the current fiscal year" — instead of the generic red failure treatment).
Unit tests added to `src/lib/ledger-category-queries.test.ts` (new prior-fiscal-year tests; the
three existing locked-year tests and the plan/apply-agreement test had their fixture fiscal years
moved off prior years — FY2024/2025 → FY2027/2028 for the locked-year tests, FY2024/2026 →
FY2026/2027 for the plan/apply test — so each test continues to isolate the specific condition its
name says it tests, now that a fiscal year can trigger either refusal independently). `e2e/ledger-category-management.spec.ts`
extended with a real-data test using `Contingency` (Foundation, 0 transactions, real FY2025 budget
row) merging toward `Disaster relief` (same scope, zero budget rows) — confirms the refusal fires
against real prior-year data with no fiscal year locked, matching the Phase 6 re-check's own
finding. **DECISION-067's Status line and item 2 below are corrected in place, struck through, not
deleted** — see that entry.

---

## DECISION-067: Ledger Category Management — merge now REFUSES the whole operation when any affected fiscal year is locked; corrects DECISION-066 item 3's inaccurate "matches both precedent scripts exactly" claim

**Status:** Resolved; item 2's closing claim corrected in place by DECISION-068 (2026-08-08) — the
lock-based guard below is necessary but was found NOT sufficient on its own (no fiscal year has
ever actually been locked in this database), so merge now ALSO refuses on fiscal-year scope,
independent of lock status. See DECISION-068 for the full correction; struck-through text below is
kept, not deleted.
**Date:** 2026-08-07

**Decision:** Two things, logged together because the second corrects the first:

1. **DECISION-066 item 3 was wrong and is corrected here, not silently edited.** It claimed the
   shipped merge behavior — re-pointing a locked prior fiscal year's budget row, disclosed via a
   `locked: true` chip but never blocked — "matches both precedent scripts exactly." It does not.
   `scripts/merge-club-budget-categories.ts` is hardcoded to a single `FY = 2026` throughout —
   every query and every `UPDATE` is scoped `WHERE fiscal_year = ${FY}` — and its own header
   comment states FY2025's `Awards`/`Supplies` rows were "DELIBERATELY NOT TOUCHED... rewriting an
   approved prior-year budget to match this year's naming would falsify the historical record."
   The shipped `mergeCategories()` (as of Phase 4/DECISION-066) fetched and re-pointed budget rows
   for every fiscal year the source category had ever touched, locked or not — a broader,
   materially different operation than the script it was supposed to match. This was caught by
   the analyst's Phase 6 shipped-vs-intent review (`docs/work-log/2026-08-07-ledger-category-management.md`)
   and confirmed by the treasurer before this feature shipped.
2. **New rule, effective now: merge REFUSES the entire operation, naming which fiscal year(s) are
   locked and why, if ANY fiscal year it would re-point is locked** — for both the `confirm:false`
   plan and the `confirm:true` apply (one code path, so they can never diverge). This is a
   **whole-merge refusal, not a partial merge that skips the locked year(s) and proceeds for the
   rest** — a partial merge would leave one category's history split across two names with no
   obvious record of why, which is harder to reason about later than simply refusing and asking
   the treasurer to unlock the year (or use a separate, more explicit path) first. The distinction
   that drives this, in the treasurer's own words: a category *name* is a label, not a figure —
   relabeling a locked year (rename) is fine. A *merge* moves a budgeted *amount* between
   categories in a year the board approved and locked — a different kind of change, and ~~the one
   place merge now hard-blocks on a lock beyond the current fiscal year.~~ **Corrected by
   DECISION-068 (2026-08-08):** this was true of the code as shipped, but the Phase 6 re-check
   found this guard alone was vacuous in practice — no fiscal year has ever actually been locked
   for either entity, so the check above never fired for the real `Awards`/`Supplies` merges it
   was meant to protect. Merge now ALSO hard-blocks on any affected fiscal year being earlier than
   the current one, regardless of lock status — see DECISION-068.

**Rationale:** Precedent scripts are only a safe spec for automated UI behavior if they're read
correctly — DECISION-066 asserted an equivalence it hadn't actually verified against the script's
own scoping and its own stated reasoning for declining to touch FY2025. Once the treasurer read
the gap in Phase 6's honest telling, the fix was clear from the same "label vs. figure" logic
Treasurer Decision 1 (rename) already established: rename never blocks on a lock because a name
isn't board-approved history in the way a budgeted amount is; merge, which does move an amount,
should therefore be the one operation that *does* block on any lock it would touch, not just the
current year's.

**Impact:** `src/lib/ledger-category-queries.ts` (`mergeCategories()` gains a new refusal step,
inserted after the both-sides-budget-collision check and before the plan is returned — checks
every entry in the computed plan for `locked: true` and refuses the whole call if any exist,
naming the year(s) in the message; `MergePlanEntry.locked` therefore always reads `false` on any
plan actually returned to a caller). `src/app/api/admin/ledger/categories/merge/route.ts` (doc
comment gains refusal step 8). `src/components/admin/ledger/category-merge-dialog.tsx` (dialog
copy explains the locked-year block plainly; the amber "locked" chip is now defensive/unreachable
display, kept rather than removed in case a future increment relaxes the block). Unit tests added
to `src/lib/ledger-category-queries.test.ts`; `e2e/ledger-category-management.spec.ts` extended
using the existing Approve & Lock fixture. DECISION-066's Status line is updated to note this
partial supersession — items 1, 2, 4, 5, and 6 of that decision are unaffected and still stand.

---

## DECISION-066: Ledger Category Management Phase 3 — one impact endpoint for three callers, 120-char caps on `name`/`form990Line`, merge shows-but-doesn't-block on locked prior years, deactivate open-balance is a warning not a block, create stays unaudited

**Status:** Superseded in part by DECISION-067 (item 3 only — items 1, 2, 4, 5, and 6 below are
unaffected and still stand)
**Date:** 2026-08-07

**Decision:** Six implementation calls closing the Phase 3 design for `docs/work-log/2026-08-07-ledger-category-management.md`, left open by Phase 1 (analyst) and/or explicitly deferred by Phase 2 (architect):

1. **One `GET .../[id]/impact` response shape serves all three callers** (rename preview, `countsAsGiving` dollar impact, deactivate open-balance warning) — `{ category, transactions: { total, postedGivingCents }, budgetLines: { total, fiscalYears[] }, openBalance }`. `postedGivingCents` reuses `getPhilanthropy`'s exact filter (`status='posted'`, no transfer group, `flow='expense'`, fund kind in `activity|charitable|scholarship`) minus the `countsAsGiving` condition, computed unconditionally so the figure is meaningful both before and after a flip.
2. **`MAX_CATEGORY_NAME_LENGTH = 120` and `MAX_FORM_990_LINE_LENGTH = 120`**, both app-layer only (DECISION-041 precedent, no DB `CHECK`), matching the existing `MAX_BUDGET_LINE_LABEL_LENGTH` cap already in `ledger.ts`. `form990Line` stays free text with a length cap only — no enum/autocomplete in v1, since no canonical IRS-line list exists anywhere in this codebase or `docs/` for one to be built against.
3. ~~**Merge's lock check stays scoped to the current fiscal year only** (architect Ruling #5, reaffirmed) — a locked *prior* year with a source-only budget row is still re-pointed by merge, matching both precedent scripts exactly. The merge plan/impact response annotates `locked: boolean` per affected year so the treasurer sees it before confirming, but it is disclosure, not a block. This is a deliberate asymmetry: merge hard-blocks only on the current year; rename shows-but-never-blocks on any locked year (Treasurer Decision 1); deactivate doesn't look at locks at all (next item).~~ **This claim was inaccurate and is corrected by DECISION-067 (2026-08-07):** `merge-club-budget-categories.ts` does NOT match this behavior — it is scoped to a single hardcoded fiscal year and its own header states the prior year's rows were "DELIBERATELY NOT TOUCHED" to avoid falsifying approved history. As of DECISION-067, merge instead REFUSES the whole operation, naming the year(s), whenever any fiscal year it would re-point is locked.
4. **Deactivating a category with an open, non-locked, non-zero current-FY budget row is a warning, not a hard block.** Phase 1 flagged this as unresolved; the architect explicitly left it to Phase 3 ("no lock-based failure case identified... worth an explicit warning, not necessarily a hard block"). Rationale: deactivation only flips `isActive` and never writes to `ledger_budgets`, so there's no data-integrity reason to block it — only a UX concern that `openBalance.hasNonLockedBudgetRow` surfaces inside the `<ConfirmDialog>` body.
5. **Category creation is not audited in v1.** Treasurer Decision 3's list (renames, merges, deactivations, flag changes) does not include creation, and architect Ruling #3 leaves `POST /api/admin/ledger/categories` completely unchanged. `ledgerAuditLog.action` reserves `'category_created'` as a documented-but-unused future value rather than silently wiring an audit write into a route Phase 2 already ruled untouched.
6. **PATCH audit-action precedence when multiple fields change in one call:** `name` changed → `category_renamed`; else `isActive` `false→true` → `category_reactivated`; else `isActive` `true→false` → `category_deactivated`; else (flags only) → `category_flags_updated`. `before`/`after` always capture every changed field regardless of which action name wins, so a simultaneous rename+deactivate loses no information to the single-action label.

**Rationale:** Each call closes a gap Phase 1 raised and Phase 2 either deferred or left as a Phase 3 judgment call, rather than inventing new structure — the impact endpoint reuses `getPhilanthropy`'s own filter instead of a parallel giving calculation; the length caps reuse the existing `MAX_BUDGET_LINE_LABEL_LENGTH` convention; the merge/rename/deactivate lock-vs-warning-vs-silent split follows directly from what each operation actually writes (merge changes `category_id` on `ledger_budgets` rows — the one place a lock-integrity argument applies; rename and deactivate change unrelated columns, so a lock check there would be protecting nothing).

**Impact:** `src/lib/db/schema.ts` (`ledgerAuditLog`), `drizzle/migrations/0074_ledger_category_audit.sql`, `src/lib/ledger.ts` (new length consts + `validateCategoryEditInput`, extended `validateCategoryCreateInput`), `src/lib/ledger-category-queries.ts` (new), four route files under `src/app/api/admin/ledger/categories/**`, new UI under `src/app/(dashboard)/admin/ledger/settings/categories/` and `src/components/admin/ledger/`. Full contracts in the work-log's Phase 3 section.

---

## DECISION-065: Ledger Category Management — new `ledger_audit_log` table (generalized schema, category-only code), `ledger-category-queries.ts` sibling module, merge reuses the scripts' dry-run/`--apply` shape as `confirm: boolean`

**Status:** Resolved
**Date:** 2026-08-07

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-08-07-ledger-category-management.md`. Seven placement/structure calls:

1. **New table `ledgerAuditLog`** (`ledger_audit_log`), not an extension of `permissionAuditLog`/`googleGroupSyncLog`/`failedLoginAttempts` (none are ledger-shaped) and not a category-only table (`ledger_category_audit_log`). Mirrors `permissionAuditLog`'s existing convention of typed nullable FK columns per target kind (`targetCategoryId` today; `targetTransactionId`/`targetBudgetId` addable later via additive migration) rather than a polymorphic `(targetType, targetId)` pair, which has no precedent in this codebase. The **schema** is deliberately named/shaped to grow into the treasurer's stated future want (transaction/budget audit) at zero later cost (one additive `ALTER TABLE ADD COLUMN IF NOT EXISTS`); the **code** is not pre-generalized — the audit-write helper lives inside `ledger-category-queries.ts` with its one real caller, per DECISION-061's "don't build the parallel structure ahead of a second consumer" precedent. Extraction to a shared `logLedgerAudit()` helper happens when a second real caller (transaction/budget audit) is actually built.
2. **New sibling module `src/lib/ledger-category-queries.ts`**, following the DECISION-049/DECISION-061 split precedent (`reconciliation-queries.ts`, `financial-report-queries.ts`, `ledger-search-queries.ts`) rather than adding to the 5,149-line `ledger-queries.ts`. Owns all new mutations (`renameCategory`, `updateCategoryFlags`, `setCategoryActive`, `mergeCategories`) plus the new read (`getCategoryImpact`); continues importing `getCategories`/`getEntityById`/`getFunds`/`assertBudgetUnlocked` from `ledger-queries.ts` unchanged.
3. **API surface:** `GET /api/admin/ledger/categories` (new, list+filters) alongside the existing unchanged `POST`; `PATCH /api/admin/ledger/categories/[id]` (new) handles rename, `countsAsGiving`, `form990Line`, **and `isActive`** as one general-purpose edit endpoint — deliberately not a one-way `POST .../deactivate` action route, because categories lack the multi-guard state machine (`reconciledSessionId`, `transferGroupId`, etc.) that justifies `transactions/[id]/{approve,reject,split}` being separate routes. Treating `isActive` as an ordinary PATCH field makes reactivation free at the API layer regardless of what Phase 3 exposes in the UI. `GET /api/admin/ledger/categories/[id]/impact` (new, read-only) serves both the rename-impact display and the deactivate open-balance warning from one query. `POST /api/admin/ledger/categories/merge` (new, top-level — not nested under `[id]`, since merge is inherently two-category, mirroring `budgets/cause-lines/collapse`/`group`) takes `{ sourceId, destinationId, confirm?: boolean }` — `confirm: false`/omitted returns the plan without writing, `confirm: true` executes, which is the exact dry-run/`--apply` discipline `merge-club-budget-categories.ts` already uses, promoted from a CLI flag to a request-body flag rather than inventing a separate preview endpoint.
4. **UI placement:** new sub-route `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx`, not a section or tab on `settings/page.tsx` (which is laid out `max-w-2xl` for a short form) — same reasoning that already makes `budgeting/[fundSlug]` a distinct route from `budgeting`. `settings/page.tsx` gains one small nav-card addition linking to it.
5. **Server/client split:** route-handler-driven throughout (no server actions — no exception exists anywhere under `/api/admin/ledger/**` today). Impact preview and merge plan are fetched on demand from client components exactly like `reconciliation-match-picker.tsx`/`split-transaction-dialog.tsx`/`fund-manage-dialog.tsx` already do, with `router.refresh()` as the sole post-mutation refresh idiom (already used in 34 files under `src/components/admin/ledger/`) — no new data-fetching library.
6. **Merge transactional integrity:** one Drizzle transaction inside `mergeCategories()`, checking only the *current* FY's lock (matching both scripts — never every year the category has touched), refusing outright on any source transaction (Treasurer Decision 2) or any fiscal year where both source and destination already have a budget row (the exact unique-constraint collision `merge-club-budget-categories.ts` guards against), computed identically for both the `confirm: false` plan and the `confirm: true` execution so they can never diverge.
7. **No new npm dependency** — confirmed against all five evaluation criteria.

**Rationale:** Every ruling extends an already-established pattern in this codebase (module-splitting precedent, `[id]`-scoped vs. top-level action routes, route-handler + `router.refresh()` convention, `permissionAuditLog`'s typed-FK audit shape, the two scripts' own dry-run/lock-check/rollback discipline) rather than inventing a new one. The one genuinely new design choice — generalizing the audit table's schema now while deferring code generalization — is deliberately asymmetric: schema changes get harder to make non-breaking the longer real rows exist under the old shape, while code extraction is cheap and safe to defer until a second real caller exists.

**Impact:** New `schema.ts` entry `ledgerAuditLog` (Ledger section, after `ledgerCategories`) + matching idempotent migration `drizzle/migrations/0074_ledger_category_audit.sql` (`CREATE TABLE IF NOT EXISTS`, guarded indexes). New file `src/lib/ledger-category-queries.ts`. New route files: `categories/[id]/route.ts`, `categories/[id]/impact/route.ts`, `categories/merge/route.ts`; `categories/route.ts` gains a `GET`. New route `src/app/(dashboard)/admin/ledger/settings/categories/`, new components under `src/components/admin/ledger/`. No new `FEATURES` key (existing `LEDGER_MANAGE` covers everything, per Treasurer Decision 5). No new npm dependency.

---

## DECISION-064: `membershipType` — snake_case token taxonomy stored in `src/lib/members.ts` (not `ledger.ts`); gated by `MEMBERS_EDIT` (not `DUES_MANAGE`); edited on the existing member-form, not a dedicated sub-route; no admin member-list column in this increment

**Status:** Resolved
**Date:** 2026-08-07

**Decision:** Four implementation calls closing the Phase 3 design for `docs/work-log/2026-08-07-membership-categories.md`, left open by Phase 1 (analyst):

1. **Token format:** stored values are lowercase `snake_case` tokens (`active`, `member_at_large`, `honorary`, `privileged`, `life_member`, `associate_member`, `affiliate_member`), paired with a `{ value, label }` options array for display — not literal display strings (`"Life Member"`) stored directly.
2. **Const location:** the taxonomy array and `isValidMembershipType()` live in `src/lib/members.ts`, next to `MembershipStatus`/`isActiveForStatus()` — not in `src/lib/ledger.ts` next to `BUDGET_CAUSES`.
3. **Permission gate:** writes go through the existing `FEATURES.MEMBERS_EDIT` gate on `PATCH /api/admin/members/[id]`, not a new `DUES_MANAGE`-gated sub-route mirroring `dues-category-control.tsx`.
4. **UI surface:** the control is a new `<select>` on the existing `member-form.tsx`, next to the Membership Status field — not a new admin members-list table column.

**Rationale:**

(1) This app has two existing enum-taxonomy precedents that point opposite directions: `membershipStatus`/`duesCategory` store bare single-word snake_case tokens compared via `===`/`.includes()` in code (`isActiveForStatus()`, dues-rate lookups); `BUDGET_CAUSES` stores full display strings verbatim (`"Vision & Eye Care"`). The `BUDGET_CAUSES` shape exists for a specific, non-repeating reason — those values must stay byte-identical to `deriveCause()`'s historical CSV-derived output (docs comment in `ledger.ts:46-53`) — a constraint `membershipType` doesn't share (fresh backfill, no historical free text to match). Phase 1's own stated payoff for this field is a future per-capita *count-and-bucket* derivation, which favors stable, code-shaped tokens over prose strings with spaces/ampersands that need normalization before comparison. Three of the seven LCI type labels are inherently multi-word ("Life Member," "Associate Member," "Affiliate Member"); the token keeps the "Member" suffix (`life_member`, not `life`) so the raw DB value is unambiguous without a label lookup, avoiding exactly the status/type collision risk Phase 1 flagged for the word "Active" — `member_type = 'life_member'` reads unambiguously next to `membership_status = 'active'` in a raw query or CSV export, where `member_type = 'life'` would not.

(2) `src/lib/ledger.ts` is a Ledger-specific module (budgets, transactions, causes) and this feature is explicitly barred from touching the Ledger (Treasurer Decision 1: "must NOT be wired into any dues run... or billing surface"). `src/lib/members.ts` already holds the sibling `MembershipStatus` type and its pure, DB-call-free, unit-tested helpers (`src/lib/members.test.ts`) — the same shape this taxonomy needs (a closed-list type + a pure validator), and the file this field is most conceptually adjacent to.

(3) Phase 1 flagged this as an open question and recommended `MEMBERS_EDIT`, noting `duesCategory` uses the narrower `DUES_MANAGE` because it has direct billing consequences. Treasurer Decision 1 resolves the open question by removing the premise: `membershipType` is explicitly walled off from dues/billing in this increment ("Dues are unaffected... must NOT be wired into any dues run"), so the rationale that justified `duesCategory`'s narrower gate doesn't apply here. `membershipType` is a general membership-record attribute edited by the same people, on the same form, as `membershipStatus` — `MEMBERS_EDIT` is the correct precedent to follow. If a future increment wires `membershipType` into billing/per-capita, that increment should revisit this gate then, not preemptively narrow it now against a use case explicitly out of scope.

(4) `duesCategory` gets its own route+component (`dues-category-control.tsx`, `/admin/dues/[memberId]`) because it's edited from the *dues* workflow by treasurer staff working the dues module, independent of the member-edit flow. `membershipType` has no equivalent standalone workflow — Phase 1 Flow 1 names the entry point as the existing member edit page, and Treasurer Decision 2 keeps it admin-only with no new surface implied. Adding it to `member-form.tsx` next to `membershipStatus` matches Phase 1's explicit labeling-discipline requirement ("admin list/detail views must show both fields adjacent to each other... so nobody edits one thinking they set the other") more directly than a separate page would. The admin members list table already carries 7 columns (name, email, branch, status, dues status, group, actions per `page.tsx:229-255`); Phase 1's Pass 1 mentions "detail/list view" but Treasurer Decision 2 only commits to admin visibility, not a specific surface. Deferring the list column keeps this increment additive-only on a page that's already dense, at the cost of requiring a click into a member's edit page to see their type — an acceptable tradeoff for a field the treasurer expects to consult rarely (Phase 1 Pass 1: "rare... only on a status milestone"). Revisit if usage shows the list column is needed.

**Impact:** `src/lib/db/schema.ts` (new `membershipType` column), `drizzle/migrations/0073_members_membership_type.sql`, `src/lib/members.ts` (`MEMBERSHIP_TYPES`, `MembershipType`, `isValidMembershipType()`), `src/components/admin/member-form.tsx` (new field + `TYPE_OPTIONS`), `src/app/api/admin/members/[id]/route.ts` and `route.ts` (validate + persist), `src/app/(dashboard)/admin/members/[id]/page.tsx` (pass `membershipType` into `MemberFormData`). No change to `src/lib/ledger.ts`, `dues-queries.ts`, or any dues/billing route.

---

## DECISION-063: Ledger & Budget Search — subtotals split by flow (never netted); inapplicable transaction-only filters are ignored-and-noted on the Budget lines section rather than forcing zero; missing-permission sections are omitted entirely (opposite rule); `?highlight=` scrolls-and-flashes only, no auto-open; lump-sum `ledgerBudgets` rows out of scope for increment 1

**Status:** Resolved
**Date:** 2026-08-06

**Decision:** Phase 3 technical-design calls for `docs/work-log/2026-08-06-ledger-search.md`, five related choices logged together:

1. **Search-result subtotals are split into `totalIncomeCents`/`totalExpenseCents`, never netted into one number**, on both `searchTransactions()` and `searchBudgetLines()`. `amountCents` is always stored positive on both tables; `flow` carries the sign. A single search term can legitimately match both income and expense rows, and netting them would silently combine opposite-direction dollars — every other ledger surface (fund-balance cards) already keeps income/expense separate rather than netting.
2. **Two different policies for "a filter doesn't affect a section," chosen deliberately opposite to each other:** a transaction-only filter (bank account, date range, status) set while viewing Budget-lines results is **ignored for scoping and called out with an inline note**, never forced to zero — forcing zero would look like "nothing matched" when the true statement is "this axis doesn't exist for budget lines." A **missing permission**, by contrast, **omits the whole section, header included** — the treasurer isn't missing an axis, she's missing the data, and a "0 budget lines" header would leak the section's existence to a user with no right to query it.
3. **`?highlight=<id>` scrolls-into-view and flashes the matching row on the register / budgeting drill-down; it does not auto-open the transaction edit dialog or the cause-line editor.** Phase 2 left this open explicitly. Both destination components already manage their own open/editing state independently of the URL; threading "start already open, on this specific row" through a server-rendered list into two structurally different client components is real added surface for a read/navigate-only feature, when "click into the details" is already satisfied by landing on the visibly-marked row. Auto-open is a self-contained fast-follow if the extra click proves annoying in practice.
4. **Lump-sum `ledgerBudgets` rows with zero `ledgerBudgetLines` children are out of scope for increment 1's budget-line search**, even when the parent's own `note` field would match the term. The query is rooted at `ledgerBudgetLines`, so a childless budget row produces no result row regardless. The treasurer's own headline example ("what do we have on WARM") is a `cause` match, and `cause` is `NOT NULL` only on lines — searching lines correctly covers the request as stated; surfacing parentless lump sums is a named, cheap-if-wanted follow-up, not a silent gap.
5. **`fyBounds()` relocates from a private helper in `ledger-queries.ts` to an exported function in `src/lib/fiscal-year.ts`**, and a new `escapeIlikeTerm()` pure helper is added to `src/lib/ledger.ts` — both pure, DB-independent functions belong with the other pure fiscal-year/ledger helpers, not duplicated into the new `ledger-search-queries.ts` module a third time.

**Rationale:** Each of these resolves an item Phase 1 (analyst) or Phase 2 (architect) explicitly flagged as unresolved rather than leaving it to Phase 4's improvisation. The common thread across 1–3 is the same one DECISION-061/060 already established for this feature area: resolve ambiguity as far upstream as possible, and prefer the answer that keeps a read/navigate-only surface honest about what it does and doesn't know, rather than the answer that's cheapest to build.

**Impact:** New file `src/lib/ledger-search-queries.ts` (`searchTransactions()`, `searchBudgetLines()`, `LedgerSearchFilters`). `src/lib/fiscal-year.ts` gains exported `fyBounds()`; `src/lib/ledger-queries.ts` loses its private copy and updates six call sites. `src/lib/ledger.ts` gains `escapeIlikeTerm()`. New route `src/app/(dashboard)/admin/ledger/search/page.tsx` and five new components under `src/components/admin/ledger/`. `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` and `budget-cause-editor.tsx`/`budget-fund-editor.tsx`/`budgeting/[fundSlug]/page.tsx` gain optional `highlight` handling via a new shared `row-highlighter.tsx`. Full contract, URL param table, and 8 named unit tests are in the Phase 3 section of `docs/work-log/2026-08-06-ledger-search.md`.

---

## DECISION-062: Ledger & Budget Search — new `ledger-search-queries.ts` sibling module; `?highlight=<id>` deep-links into the existing register/budgeting pages instead of a new detail surface; no `pg_trgm`/new index at current data volume

**Status:** Resolved
**Date:** 2026-08-06

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-08-06-ledger-search.md`. Three placement calls:

1. **New sibling module `src/lib/ledger-search-queries.ts`**, not an addition to `ledger-queries.ts` (already 5,161 lines / ~199KB — the largest file in `src/lib`). Mirrors the precedent set by `reconciliation-queries.ts` and `financial-report-queries.ts` (DECISION-049): a distinct cross-cutting read surface composing the existing engine, not a rework of it. `listTransactions()`'s existing `search` opt (party/memo only, single-entity-scoped) is not reused as-is — the new module writes its own cross-entity, full-field queries — but the private `fyBounds(fy)` helper (currently unexported in `ledger-queries.ts`, used by every other FY-filtered query in that file) should be exported (or, preferably, relocated to `src/lib/fiscal-year.ts` alongside `getFiscalYear`/`currentFiscalYear` — it's pure date math with no DB dependency and belongs there structurally) rather than reimplemented a third time.
2. **`?highlight=<id>` deep-link param, owned by search, honored by the existing register and budgeting-drill-down pages** — not a new search-owned detail surface. A bespoke detail page would be a third rendering path for the same transaction/budget-line data (alongside the register and the budgeting drill-down), duplicating permission checks and going stale relative to whichever of the other two pages can actually edit the row. `/admin/ledger?entity=&fy=&highlight=<txnId>` and `/admin/ledger/budgeting/[fundSlug]?entity=&fy=&highlight=<budgetLineId>` are small, additive, backward-compatible params on pages that already read `?entity=&fy=`. Whether the highlight scrolls-and-styles only or also auto-opens `TransactionFormDialog` is a Phase 3 UX call, not an architectural one.
3. **No new index, no `pg_trgm`.** `ledger_transactions` already carries 7 indexes and `ledger_budget_lines` one, none on the free-text columns this feature searches (`party`, `memo`, `beneficiary_cause`, `check_number`, `cause`, `label`, `note`); the codebase has zero existing trigram/GIN precedent in `drizzle/migrations/`. At "a few hundred transactions" a sequential `ILIKE` scan is not a performance problem worth a new Postgres extension and 4–7 maintained indexes for an admin-only, on-demand search box.

**Rationale:** Every one of these mirrors an existing, already-approved pattern in this codebase (module-splitting precedent, `?entity=&fy=`-style URL-driven pages, `ILIKE`-based search, no premature indexing) rather than inventing a new shape. The alternative on each — dumping into `ledger-queries.ts`, a standalone search-detail page, or a `pg_trgm` index — would either worsen an existing hotspot (file size) or add infrastructure this club's data volume doesn't need.

**Impact:** New file `src/lib/ledger-search-queries.ts`. New route `src/app/(dashboard)/admin/ledger/search/`. New components under `src/components/admin/ledger/` (quick-search box, advanced filter panel, transaction/budget-line result renderers). Two existing surfaces (register, budgeting drill-down) gain optional `highlight` handling. `ledger-queries.ts`'s `fyBounds()` becomes exported or moves to `fiscal-year.ts` (tech-lead's call in Phase 3) — additive, no behavior change to existing callers. No schema changes, no new npm dependency, no new `FEATURES` key.

---

## DECISION-061: Explicit transaction↔budget-line link (B-30) — enrich `causeLines[]` in place rather than a parallel map; reimbursement mark-paid requires a category; PATCH auto-clears a stale link instead of rejecting; collapse-count sourced from the report already in hand

**Status:** Resolved
**Date:** 2026-07-30

**Decision:** Four related implementation choices from B-30's Phase 3 design
(`docs/work-log/2026-07-30-transaction-budget-line-link.md`), logged together since none
reads sensibly alone:

1. **The exact/fuzzy report aggregation enriches each `FundReportCategoryLine.causeLines[]`
   item in place** (`linkedActualCents`, `linkedTransactionCount`, `actualCents`,
   `isFuzzyFallback`, all resolved via a new `resolveCauseLineActual()` pure helper) rather
   than adding a parallel top-level `actualByBudgetLineId` map to `FundReport` that every
   consumer would have to re-key against `causeLines[].id` themselves. Every consumer
   (admin Fund Report table, member Statement, the collapse-warning count) wants the
   per-line number already resolved, not a raw map to join against a second time.
2. **The reimbursement mark-paid pay action's new `categoryId` field is REQUIRED, not
   merely encouraged** — Phase 1 had left this an open lean ("required-or-strongly-
   encouraged"). Made required because the entire point of this pass is closing the
   permanent blind spot Phase 1 confirmed (reimbursement-derived transactions invisible to
   every budget-vs-actual view); an optional field would let the gap persist by default for
   every treasurer who doesn't notice it.
3. **The transaction PATCH route auto-clears a now-stale `budgetLineId` link (moving the
   FY or category out from under it) rather than rejecting the whole edit with a 400.**
   Silently-stale would be worse (Phase 1's own framing), but a hard rejection would block
   an otherwise-valid date/category correction just because an old link no longer applies.
   Auto-clear + a `budgetLineLinkCleared: true` response flag (surfaced as toast microcopy)
   lets the edit succeed while making the side effect visible, not silent.
4. **The collapse-with-links `<ConfirmDialog>`'s linked-transaction count is sourced from
   data the report query already fetches** (`linkedTransactionCount` on each enriched
   `causeLines[]` item, per decision 1 above) rather than a new endpoint or a live query
   fired when the treasurer clicks "Collapse." Zero extra round-trip; the count is already
   sitting in the same props `BudgetCauseEditor` already receives via `causeActualsByKey`'s
   existing bubble-through path.

**Rationale:** All four are the same underlying call — resolve information as far
upstream (the query layer) as possible, so every downstream consumer (three report
surfaces, one confirm dialog, one route handler) reads a value that's already correct
rather than re-deriving or re-fetching it. This mirrors DECISION-060's own reasoning for
promoting `computeFundPlanSums` to a shared export: two-plus consumers of the same
computation should share one source, not reimplement or re-key it.

**Impact:** `src/lib/db/schema.ts` gains `ledgerTransactions.budgetLineId` (nullable FK,
`onDelete: 'set null'`) + index; `drizzle/migrations/0072_ledger_txn_budget_line.sql`.
`src/lib/ledger.ts` gains `resolveCauseLineActual()`, `isEligibleForFuzzyCauseMatch()`,
`shouldClearBudgetLineLink()` (each unit-tested). `src/lib/ledger-queries.ts`'s
`getFundReport()` and `src/lib/financial-report-queries.ts`'s `computeOneMonthCashActuals()`
/ `getMonthlyStatement()` gain the exact/fuzzy split described above.
`src/app/api/admin/ledger/reimbursements/[id]/route.ts`'s pay action gains a required
`categoryId` body field (behavior change to an existing flow — flagged for qa's
click-through). `src/app/api/admin/ledger/transactions/[id]/route.ts` gains the auto-clear
logic + response flag. Full design in `docs/work-log/2026-07-30-transaction-budget-line-link.md`'s
Phase 3 section.

---

## DECISION-060: Budget-level Notes & Assumptions get their own table; the shared fund-plan-sum helper moves from a print-private function to a `src/lib/ledger.ts` export

**Status:** Resolved
**Date:** 2026-07-30

**Decision:** Two related implementation choices from the Budgeting Overview/Drill-Down Restructure's Phase 3 design (`docs/work-log/2026-07-30-budgeting-overview-restructure.md`), logged together since neither reads sensibly alone:

1. **`ledger_budget_notes` is a new, separate table** — `(id, entity_id, fiscal_year, notes, updated_by_user_id, updated_at, created_at)`, unique on `(entity_id, fiscal_year)`, mirroring `ledger_budget_approvals`'s shape — rather than a nullable `notes` column added to `ledger_budget_approvals` itself. Write path gates on `LEDGER_MANAGE`/`BUDGET_EDIT` only; it never checks `locked` (mirrors the existing `budgets/annotations` route's category-star/notes precedent, DECISION-057).
2. **`computeFundPlanSums`** — the pure "sum one fund's committed budget lines into income/expense totals, correctly excluding pending-delete lines/cause-lines" helper — is promoted to a named export in `src/lib/ledger.ts`, beside `computeFundLineSums`. B-31's own Phase 3 design (same work-log, written earlier the same day) had planned this as a private `printFundSums` function inside `budget-print-worksheet.tsx`, reasonable when print was its only consumer.

**Rationale:** (1) A draft budget has no `ledger_budget_approvals` row at all — `getBudgetApproval` returns `null` until the first Approve & Lock — so a nullable column on that table couldn't hold a note written *during* drafting, which is the primary use case (NFF's "notes/assumptions pre-empt board questions," cited in B-31's research). A separate, independently-keyed, lazily-created table is the only shape that supports "write your assumptions down before the row that would host them exists." Gating the write on `LEDGER_MANAGE`/`BUDGET_EDIT` with no lock check mirrors DECISION-057's already-shipped reasoning: commentary isn't a budget figure, and a board that just approved a budget still needs to annotate it. (2) The Budgeting Overview/Drill-Down Restructure's new `BudgetOverviewTable` needs the identical computation B-31 designed for print — same committed `FundSetupItem[]` input, same three-map-then-`computeFundLineSums()` recipe — to derive its on-screen summary rows. Two consumers of one private helper is the exact "don't copy a private helper into a second file" pattern the architect flagged twice in this restructure's Phase 2 review (Rulings 3 and 4, re: `budget-plan-status.tsx` and `LoadErrorCard`); promoting it to a shared export makes "overview screen, drill-down's live editor, and the printed document can never structurally disagree" true by construction — both the overview and print call the same function on the same data — rather than by convention.

**Impact:** `src/lib/db/schema.ts` gains `ledgerBudgetNotes`; `drizzle/migrations/0071_ledger_budget_notes.sql` (idempotent, no seed data); `src/lib/ledger-queries.ts` gains `getBudgetNotes(entityId, fiscalYear)`; new `PATCH /api/admin/ledger/budget-notes` route (inline upsert, mirroring `budget-approvals/route.ts`'s pattern, no `db.transaction()` needed — single-table, single-row). `src/lib/ledger.ts` gains `computeFundPlanSums`, with its own Vitest suite (cause-line-pending-cents case is the one easy-to-drop step, same risk B-31's design already flagged for `printFundSums`). `budget-print-worksheet.tsx`'s rebuild (per B-31's already-written Phase 3 layout/pagination design, unchanged) imports `computeFundPlanSums` from `@/lib/ledger` instead of defining it privately, and gains a `budgetNotes` prop rendered as a front-page "Notes & Assumptions" block. Full component/prop design, migration text, and implementation order are in the Phase 3 section of `docs/work-log/2026-07-30-budgeting-overview-restructure.md`.

---

## DECISION-059: Deposit-in-transit carve-out — full `flow='income'` symmetry, retiring the 12-day Zeffy window and the check+income exclusion; bundled "unremitted deposits" dashboard view

**Status:** Resolved — supersedes DECISION-051 item 3 and the `payment_method='check'` exclusion locked in `docs/work-log/2026-07-28-report-gate-outstanding-checks.md`
**Date:** 2026-07-30

**Decision:** `isMonthGatedForEntity()`'s income-side carve-out becomes `isUnclearedDepositRow(r) => r.flow === 'income'` — every posted, unreconciled deposit, regardless of `paymentMethod` and regardless of age, mirroring `isOutstandingCheckRow()`'s own shape (`paymentMethod` ignored entirely; no time bound). This replaces `isInTransitZeffyDepositRow()` (method-restricted to `zeffy`, bounded to a 12-day `asOf`-anchored window) and reopens the `payment_method='check', flow='income'` case that the 2026-07-28 outstanding-check fix deliberately kept gating. The now-dead `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS` constant, `daysBetween()` helper, and the `asOf` parameter on `isMonthGatedForEntity()` (used only by the retired predicate) are removed; `getLatestOpenMonthForEntity()` keeps its own `asOf` param (it independently drives `ceilingMonth`/`currentMonthKey`) but stops threading it into `isMonthGatedForEntity()`. Ships bundled with a new cross-entity "Unremitted Deposits" panel on the admin Ledger dashboard (`getDashboard()` / `/admin/ledger`), mirroring the existing `uncashedChecks` list — `flow='income', status='posted', reconciled=false`, oldest-first, both entities — so the fix doesn't remove the only visibility a stale/never-clearing deposit had.

**Rationale:** The structural lag the carve-out exists to absorb (bank-posting time + waiting for the treasurer's next reconciliation session) is uniform across every deposit rail — Zeffy, check-received, cash — not Zeffy-specific, so scoping the carve-out to one payment method just relocates the same bug to whichever method is excluded (proven by this bug's own repro: a $725 June batch of 5 Zeffy rows plus one check-received row, where the check-received row was gating independent of the Zeffy window question). The original check+income exclusion assumed a paper check might sit un-banked; checkbook-basis recording (T-24) means a posted `flow='income'` row already represents a deposit the treasurer has made, so that distinction doesn't hold. The gate has never protected displayed figures — Twelve-Month/Budget are posted-basis via `getFundReport()` (no `reconciled` filter at all) and One-Month is bank-clear-date bucketed (already excludes unreconciled rows regardless of gate state) — so relaxing the gate only changes whether a month's card is offered, never a number inside it. The residual risk (a deposit that never truly clears) is a data-integrity concern the system already accepts symmetrically on the expense side via `uncashedChecks`; the new "Unremitted Deposits" panel gives it the same permanent, unbounded-age visibility net rather than leaving the relaxed gate as a net loss of visibility.

**Impact:** `src/lib/financial-report-queries.ts` — `isInTransitZeffyDepositRow`/`daysBetween`/`IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS` deleted, replaced by `isUnclearedDepositRow`; `isMonthGatedForEntity()` loses its `asOf` param; `getLatestOpenMonthForEntity()`'s `blockingDates` filter and final re-check updated to match. `src/lib/financial-report-queries.test.ts` — the `STILL gates on an unreconciled check+INCOME row` test flips to assert it no longer gates; the two 12-day-window tests (`does NOT gate on a recent in-transit Zeffy deposit`, `STILL gates on the SAME Zeffy deposit once it's stale`) are replaced with method-agnostic, age-agnostic symmetry tests; `getLatestOpenMonthForEntity`'s `DOES truncate ... genuinely stale` test flips to assert it no longer truncates. `src/lib/ledger-queries.ts` — `getDashboard()` gains a parallel `unremittedDeposits: UnremittedDepositRow[]` query and field on `DashboardData`, no new permission (rides the existing `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE` page gate). New `src/components/admin/ledger/unremitted-deposits-panel.tsx`, rendered in `ledger-dashboard.tsx` alongside `UncashedChecksPanel`. No schema change. Full predicate text, retired-param trace, and the exact test list are in the Phase 3 section of `docs/work-log/2026-07-30-deposit-in-transit-carveout.md`.

---

## DECISION-058: Cross-Entity Sweep / Account-Transfer — directional allow-list isolated in a new pure `ledger-transfer-policy.ts`; extend `handleTransfer` rather than a new route; approve-route `boardMinute` becomes "required only if not already set"

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Ship the deny-by-default directional allow-list (`docs/work-log/2026-07-29-ledger-account-transfers.md`)
as a single pure function, `checkTransferDirection(source, dest)` in a new file
`src/lib/ledger-transfer-policy.ts` — one `if` branch per matrix cell, no DB import, fully
unit-testable in isolation. It is called from inside the existing `handleTransfer` in
`src/app/api/admin/ledger/transactions/route.ts`, which is extended in place (new body fields
`sourceBankAccountId`/`destBankAccountId` replacing the single `bankAccountId`, plus optional
`boardMinute`/`destCategoryId`) rather than forked into a new route — the two "modes" (Transfer,
Sweep) collapse into one allow-list decision and share all existing amount/date validation. The
over-threshold disbursement-approval check (`disbApprovalThresholdCents`) is now applied once to
the pair and both legs are inserted with the same derived `status` inside the existing
transaction-wrapped two-row insert — closing the "transfers always post, bypassing approval" gap.
`POST .../[id]/approve` and `.../[id]/reject` become pair-aware (fetch the partner leg by
`transferGroupId`, validate both pending, update both atomically); the approve route's
`boardMinute` requirement changes from unconditionally-required to **required only when the row
doesn't already have one** — a Sweep's creation-time board-minute citation survives an
over-threshold approval instead of being silently overwritten by a blank field. `PATCH
.../[id]?both=true` is fixed to stop applying an edited `bankAccountId` to both legs of a pair
(`route.ts:464`) — per-leg bank account becomes immutable post-creation for any transfer/sweep
pair, correcting a bug the old same-entity/one-bank-account invariant made invisible.

**Rationale:** Isolating the allow-list in its own file (rather than adding it to
`src/lib/ledger.ts`, which computes DB-derived reporting metrics like `firewallViolations` from an
already-fetched transaction list) keeps a pre-insert decision gate — primitive inputs, no DB,
called before any row exists — testable without mocking the database; every cell of the Phase 1
matrix becomes one direct function call in a unit test. Extending `handleTransfer` instead of
adding a new route avoids duplicating validation that's already correct and shared. The
`boardMinute`-preservation fix is a strict generalization of the existing approve-route behavior
(ordinary expenses, which never have a pre-set `boardMinute`, are unaffected) rather than a new
special case.

**Impact:** New file `src/lib/ledger-transfer-policy.ts`. Rewrites: `handleTransfer()` in
`src/app/api/admin/ledger/transactions/route.ts`; `POST .../[id]/approve/route.ts`; `POST
.../[id]/reject/route.ts`; the `?both=true` branch in `PATCH .../[id]/route.ts`;
`getPendingApprovals` in `src/lib/ledger-queries.ts` (dedup a pending pair to one row). Client:
`TransactionForm`'s single `"transfer"` `FlowMode` splits into `"transfer"`/`"sweep"`, with a new
`crossEntityContext` prop on Club pages only; `[fundSlug]/page.tsx` fetches the Foundation's
funds/bank-accounts/categories when rendering for the Club entity. No schema changes, no new
`FEATURES` key. See the Phase 3 design in `docs/work-log/2026-07-29-ledger-account-transfers.md`
for the full matrix, field-by-field leg construction, edge cases, and the unit-test list.

---

## DECISION-057: Budget Star & Notes — lazy-create upsert keeps `annualAmountCents` out of the conflict `SET`; star/note routed through two new endpoints that never call `assertBudgetUnlocked()`

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Add `starred boolean not null default false` + `note text` (nullable, no default) to
both `ledger_budgets` and `ledger_budget_lines` (`drizzle/migrations/0068_ledger_budget_star_notes.sql`).
Category-grain star/note writes go through a new `PATCH /api/admin/ledger/budgets/annotations`,
backed by `setBudgetCategoryAnnotation()`, whose lazy-create upsert puts `annualAmountCents: 0`
**only** in the insert `.values()` and builds the `onConflictDoUpdate` `set` clause
**conditionally** — `starred`/`note` are included only when the caller actually sent them, so a
star-only click never blanks an existing note and never touches an existing budgeted amount.
Cause-line-grain star/note writes go through a new sibling `PATCH
/api/admin/ledger/budgets/cause-lines/annotations`, backed by `setBudgetCauseLineAnnotation()` —
a plain conditional `UPDATE` against an existing row by `id`, no lazy-create (a cause line only
ever exists once actually created). **Neither new query function calls
`assertBudgetUnlocked()`, on purpose** — both route files carry a loud header comment stating the
omission is intentional (Phase 1 Decision 6: stars/notes stay editable even when the FY budget is
Approve-&-locked) and citing this decision, so a future "audit every write path for a missing lock
check" pass doesn't silently "fix" it.

**Rationale:** The lazy-create shape mirrors `upsertBudgetLine`'s existing insert/conflict pattern
closely enough that copying it verbatim (as `upsertBudgetLine` itself does, re-writing
`annualAmountCents` in both the insert and the conflict `set`) would be an easy, silent way to
zero out a real budgeted amount the first time someone stars an already-budgeted category — the
architect flagged this in Phase 2 as the single highest-risk implementation-correctness landmine
in this feature, so the exact Drizzle shape is spelled out here rather than left to be
independently re-derived. Routing star/note through two brand-new endpoints, rather than a third
body shape on either existing lock-gated PATCH dispatcher (`/budgets`, `/budgets/cause-lines`),
keeps a lock-gated and a deliberately-non-lock-gated write path from sharing one dispatch function
distinguished only by which body keys are present — exactly the shape that gets miscopied later.
Skipping `assertBudgetUnlocked()` at all is itself the first exception to an otherwise-universal
"every budget write path is lock-gated" invariant in this codebase; making that omission loud and
self-documenting at the call site is cheaper than relying on every future reader to already know
this work-log exists.

**Impact:** `src/lib/db/schema.ts` (`ledgerBudgets`/`ledgerBudgetLines` gain `starred`/`note`,
each with a doc comment pointing at this decision and at the Phase 1 Decision 9 admin-only
boundary); `drizzle/migrations/0068_ledger_budget_star_notes.sql`; `src/lib/ledger.ts`
(`MAX_BUDGET_NOTE_LENGTH = 500`); `src/lib/ledger-queries.ts` (`setBudgetCategoryAnnotation`,
`setBudgetCauseLineAnnotation`, `getFundReport`'s widened `FundReportCategoryLine`/`causeLines[]`);
two new route files under `src/app/api/admin/ledger/budgets/`. Full design in
`docs/work-log/2026-07-28-budget-star-notes.md` Phase 3.

---

## DECISION-056: Budgeting Page Restructure — `ledger_budget_lines.pending_delete_at` mirrors `ledger_budgets.pending_delete_at` exactly, one idempotent `ADD COLUMN`, no index/backfill

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Add `pendingDeleteAt: timestamp("pending_delete_at")` to `ledgerBudgetLines` in
`src/lib/db/schema.ts` — same nullable-timestamp shape, no default, as
`ledgerBudgets.pendingDeleteAt` (DECISION-052/053). One idempotent
`ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;` in
`drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`, matching
`0066_ledger_budgets_pending_delete.sql` verbatim in shape. No new index — the column is only
ever filtered alongside `budget_id`, already covered by `ix_ledger_budget_lines_budget`. No
backfill — every pre-existing row becomes `NULL` (not pending-delete), the correct default with
zero migration-time write.

**Rationale:** This is the schema half of Q1's resolution (Chris, 2026-07-29 — see
`docs/work-log/2026-07-29-budgeting-restructure.md`): category removal becomes uniformly
reversible-until-finalize regardless of breakdown state. Mirroring the existing column exactly,
rather than inventing a new shape, keeps `setBudgetCauseLinePendingDelete` a pure flag-flip with
the same "restore brings the number back exactly by construction" property the category-grain
function already has.

**Impact:** `src/lib/db/schema.ts`, `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`.
Implementer: database-admin.

---

## DECISION-055: Budgeting Page Restructure — line-item removal becomes a `pendingDeleteAt` flag-flip, not a delayed hard `DELETE`; new cause-group route follows the `.../collapse` sibling-route precedent

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Three implementation calls closing Phase 3 for
`docs/work-log/2026-07-29-budgeting-restructure.md`, on top of the architect's Phase 2 rulings:

1. **Single line-item removal (Flow 4) becomes a `PATCH .../cause-lines { id, pendingDelete }`
   flag-flip, not a delayed hard `DELETE`.** The alternative reading — keep the existing `DELETE`
   handler as a true hard delete and just hold the client's call to it until the toast expires —
   was rejected because it would leave `ledger_budget_lines.pendingDeleteAt` (the column Q1 adds)
   with no interactive write path at all: category-level removal never cascades a write onto
   children (Ruling 4), so the single-line and cause-group removal flows are the *only* places
   that column is ever set. A flag-flip also gives line-item removal the same
   "recoverable-until-finalize via a persistent Restore control" property every other grain now
   has, which is the uniform mental model Q1 asked for — a delayed-but-still-hard delete would
   have made line items the one grain that's unrecoverable once the toast closes, an inconsistency
   the whole feature exists to remove.
2. **Cause-group cascade delete (Flow 5) gets its own sibling route,
   `PATCH /api/admin/ledger/budgets/cause-lines/group`**, rather than a fourth body-shape branch
   on the existing single-line PATCH. Its addressing shape (`fundId, fiscalYear, categoryId, flow,
   cause`) is structurally different from the single-line route's `{ id }` addressing, the same
   reasoning that already gave `.../cause-lines/collapse` its own file instead of folding into the
   main PATCH.
3. **The existing `DELETE /api/admin/ledger/budgets/cause-lines` handler is left in place,
   unused by the new UI, rather than deleted.** Removing dead code is a 30-day code-review
   candidate, not a Phase 4 side quest — deleting it now risks breaking a caller this design
   pass didn't find.

**Rationale:** Every write path this feature introduces reuses the existing PATCH-with-mutually-
exclusive-body-shape convention (DECISION-053 item 1) rather than forking new auth/lock-guard
sequences — the cost of a slightly bigger single-route dispatch is smaller than the cost of N
routes each re-deriving the same fund/category/lock lookups.

**Impact:** New `setBudgetCauseLinePendingDelete` and `setBudgetCauseGroupPendingDelete` in
`src/lib/ledger-queries.ts`; extended dispatch in
`src/app/api/admin/ledger/budgets/cause-lines/route.ts`; new
`src/app/api/admin/ledger/budgets/cause-lines/group/route.ts`. See the Phase 3 design doc in
`docs/work-log/2026-07-29-budgeting-restructure.md` for full request/response shapes.

---

## DECISION-054: Budgeting Page Restructure — blur/click race fixed with `onMouseDown` `preventDefault()`; `computeFundLineSums` gains a third cents-to-subtract parameter; one shared `isCauseLineLive` OR-predicate

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Two implementation calls closing Phase 3 for
`docs/work-log/2026-07-29-budgeting-restructure.md`:

1. **The blur-vs-click race (Gap 4) is fixed with `onMouseDown={(e) => e.preventDefault()}` on
   every add/remove/restore/collapse control** across `budget-editor.tsx` and
   `budget-cause-editor.tsx`, over the analyst's other two candidate directions. Rejected:
   guaranteeing "no remount ever happens" across every render path this feature touches (too
   fragile to future regression, no test would catch a re-break). Rejected: disabling every
   control during any in-flight commit anywhere on the page (fights the feature's own "reliable on
   the first click" goal by adding friction to non-racing sequences). Chosen: suppress the
   blur-triggered commit from ever queuing in the first place when the mousedown target is a
   control about to consume the click — this is the standard fix for this exact class of bug and
   needs no assumption about the rest of the tree's remount behavior.
2. **`computeFundLineSums` (`src/lib/ledger.ts`) gains a third parameter**,
   `causeLinePendingCents: Record<string, number>` (`${categoryId}_${flow}` → cents to subtract),
   defaulted to `{}` for backward compatibility. Needed because cause-line-grain pending-delete
   never touches the parent's `annualAmountCents` (architect Ruling 1) — without this third
   subtraction, the re-seeded `lineValues` a category's live total is built from would silently
   include a dead cause line's dollars after every `router.refresh()`, not just between
   keystrokes.
3. **One shared pure predicate, `isCauseLineLive(causeLinePendingDeleteAt, categoryPendingDeleteAt)`**,
   added to `src/lib/ledger.ts` and reused by the print worksheet's data assembly and the
   `causeLinePendingCents` seed function in `guided-budget-setup.tsx` — the architect's explicit
   ask that the print worksheet, live-totals helper, and finalize-purge not each reinvent slightly
   different exclusion logic.

**Rationale:** All three keep the existing Vitest-seam discipline (pure functions, no DB access)
this feature area already established, and none require a new dependency.

**Impact:** `src/lib/ledger.ts` (`computeFundLineSums` signature change, new `isCauseLineLive`
export); `src/components/admin/ledger/budget-editor.tsx` and `budget-cause-editor.tsx` (new
`onMouseDown` handlers); `src/components/admin/ledger/guided-budget-setup.tsx` (new
`causeLinePendingCents` state, seeded/re-synced alongside the existing `lineValues`/
`pendingDeleteKeys` pair). See the Phase 3 design doc for full detail.

---

## DECISION-053: Budget soft-delete (Increment 2) — one PATCH route with a mutually-exclusive body shape, a shared pure client decision function, string-typed `pendingDeleteAt`, and print excludes pending-delete lines

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Five implementation calls closing Phase 3 for `docs/work-log/2026-07-28-budgeting-page-redesign.md` Increment 2, on top of DECISION-052's rulings:

1. **One route, one mutually-exclusive body shape — no new route.** `PATCH /api/admin/ledger/budgets` gains a second, mutually-exclusive request shape: `{ fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }` alongside the existing `{ ..., annualAmountCents: number | null }`. A request carrying both `annualAmountCents` and `pendingDelete` is a 400. This keeps one endpoint, one auth check, one 409-shape for the lock race — consistent with `upsertBudgetLine`'s own "one shared core" precedent — rather than forking a second route that would duplicate the fund/category/lock/cause-line-children guard sequence.
2. **The new write path 404s when no row exists, for both directions.** `setBudgetLinePendingDelete` (sibling to `upsertBudgetLine`) requires an existing `(fundId, fiscalYear, categoryId, flow)` row and returns 404 if none is found — it never silently creates one. The client-side "genuinely-never-saved blank is a no-op" rule (DECISION-052 item 2) means the UI should never actually trigger this 404 in normal use; it exists purely as defense-in-depth against a stale-tab race (e.g., someone else deleted the category concurrently), matching this codebase's existing posture of not trusting client-side gates alone.
3. **A shared pure decision function, `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)`, lives in `src/lib/ledger.ts` and is unit-tested directly** rather than leaving the blank-vs-no-op branch as inline logic inside `budget-editor.tsx`'s event handlers. This is the one piece of Increment 2's client logic that has no natural place in a Vitest suite otherwise (everything else routes through server functions), and the codebase already has precedent for pulling UI-decision logic into pure, tested helpers in `ledger.ts` (`isBudgetLocked`, `computeBudgetBalanceStatus`, `formatBudgetReferenceCents`).
4. **`pendingDeleteAt` is serialized to an ISO string (or `null`) at the `getFundReport` boundary, not passed as a raw `Date`.** Matches the existing convention at this exact Server-Component-to-Client-Component boundary (`budgeting/page.tsx`'s `formatApprovalDate` already converts `LedgerBudgetApproval`'s `Date` fields to strings/labels before handing them to `GuidedBudgetSetup`) rather than introducing a new pattern of passing `Date` objects across that boundary.
5. **The print worksheet (`budget-print-worksheet.tsx`) excludes pending-delete lines entirely** rather than printing them with a "deleted" annotation. A worksheet exists to plan and hand-annotate the budget that will actually take effect; a line already marked for removal isn't part of that forward-looking plan, and Increment 1's worksheet is a static, forward-looking snapshot by design (Phase 1: "render the current value as static text"). `GuidedBudgetSetup` (the interactive, on-screen view) still renders pending-delete rows with the strikethrough/Restore treatment — only the print path filters them out.

**Rationale:** Every one of these keeps the "one code path per concern" shape DECISION-052 already established for this increment: one route instead of two, one server-side existence check instead of a special no-op response, one pure function instead of scattered inline branches, one boundary-serialization convention instead of a new one, and one clear answer (exclude) to the print-worksheet question the tech-lead brief itself flagged as needing confirmation rather than silent invention.

**Impact:** `src/app/api/admin/ledger/budgets/route.ts` (branch on `pendingDelete` vs `annualAmountCents`, 400 on both/neither), `src/lib/ledger-queries.ts` (`setBudgetLinePendingDelete`, `getBudgetApproval` gains an optional `tx` param, `getFundReport`'s `FundReportCategoryLine.pendingDeleteAt: string | null`), `src/lib/ledger.ts` (`resolveBudgetLineDeleteAction`), `src/components/admin/ledger/budget-editor.tsx` / `guided-budget-setup.tsx` (shared decision function wired into both gestures, `pendingDeleteKeys` client state for the instant `fundSums()` exclusion, Approve dialog's `pendingDeleteCount` + conditional `destructive`), `src/components/admin/ledger/budget-print-worksheet.tsx` (filter pending-delete lines out of every `FlowTable`). Full API contract and named unit tests in the Phase 3 section of the work-log.

---

## DECISION-052: Budget soft-delete (Increment 2) — client-side running-total exclusion, not a `getFundReport` filter; blank-input and trash-icon unified onto one soft-delete path

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Two rulings closing Phase 2 for `docs/work-log/2026-07-28-budgeting-page-redesign.md` Increment 2 (soft-delete/restore-until-finalize on `ledger_budgets`, category/flow grain):

1. **The live "excluded from the running total" behavior is a client-side projection inside `guided-budget-setup.tsx`'s `fundSums()`, not a filter inside `getFundReport()`.** `getFundReport()`'s aggregate totals (`totalIncomeCents`/`totalExpenseCents`/`endingCents`) are already computed from posted actual transactions, never from summed `budgetCents` — there is no fund-level budget aggregate inside that function to filter in the first place. The live balance badge the treasurer sees while editing is computed entirely client-side from local `lineValues` state. `getFundReport` gains one new optional, purely informational field (`pendingDeleteAt` per category line, sourced off the row set it already fetches) but its `budgetCents`/`variance`/totals stay computed from the full, committed row set unchanged — because `getFundReport`'s budget figures also feed the admin fund-report page and, via `financial-report-queries.ts`, the **member-facing** Monthly Statement, both of which must keep showing the committed budget until finalize actually happens. Filtering `getFundReport` globally would leak an uncommitted, mid-session edit onto a member's own statement before the treasurer ever clicks Approve & lock — a direct violation of "only on finalize does the deletion take effect."
2. **Blanking a budget input and clicking the trash icon must be unified onto the same soft-delete write path for any already-persisted row; only a genuinely-never-saved row still gets a true no-op.** Today both gestures call `PATCH { annualAmountCents: null }`, which hard-deletes unconditionally. Leaving blank-input-then-blur/Enter on that path while only decorating the trash icon would leave the more accident-prone gesture (a stray backspace) exactly as dangerous as before soft-delete existed — shipping a feature that doesn't fix the problem it exists to fix. The new write path (a sibling function next to `upsertBudgetLine`, running the identical fund/category/lock/cause-line-children guard sequence) only flips `pending_delete_at`, never touches `annualAmountCents` — this is what makes "restore brings the number back" true by construction rather than by special-casing.

**Rationale:** Both rulings protect the same invariant from two different angles — soft-delete must be reversible-until-finalize in fact, not just in the one UI affordance that got a redesign. Filtering `getFundReport` would make the reversibility fiction leak to members; leaving blank-input wired to hard-delete would make it a fiction for the treasurer's own most common gesture.

**Impact:** `src/lib/db/schema.ts` — `ledgerBudgets` gains nullable `pendingDeleteAt` (migration `0066_ledger_budgets_pending_delete.sql`, `ADD COLUMN IF NOT EXISTS`, no index). `src/lib/ledger-queries.ts` — `getFundReport`'s `FundReportCategoryLine` gains optional `pendingDeleteAt`; new sibling write function alongside `upsertBudgetLine`; `POST /api/admin/ledger/budget-approvals` gains a `db.transaction()` wrapper purging `pending_delete_at IS NOT NULL` rows atomically with the lock write. `src/components/admin/ledger/budget-editor.tsx`/`guided-budget-setup.tsx` — remove-line `ConfirmDialog` dropped (removal is reversible now), both delete gestures rewired to the new path, `fundSums()` excludes pending-delete lines live. Full detail in the Increment 2 Phase 2 section of the work-log.

---

## DECISION-051: Batch reconciliation — array-only match body (no back-compat shim), new session-scoped match-detail query, `asOf`-anchored 12-day in-transit-deposit window

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Four implementation calls closing Phase 3 for `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md`, on top of DECISION-036's schema ruling and the architect's Phase 2 seams:

1. **`POST .../match`'s request body drops the singular `transactionId` entirely in favor of `transactionIds: string[]` (array-only, min length 1) — no back-compat alias.** This route has exactly one caller in the codebase (`reconciliation-match-picker.tsx`), rewritten in this same feature; there is no external consumer to break. A 1-element array is the degenerate single-match case, so there is only ever one code path to maintain, per the architect's Phase 2 recommendation.
2. **A new read helper, `getMatchedTransactionsForSession()`, joins `ledger_reconciliation_matches` → `ledger_transactions` (one query, whole session, no N+1)** rather than trying to make `getBankLinesForSession()`'s `matchedTransactionIds: string[]` carry enough information to render Flow 2's expandable per-transaction list. `candidateTransactions` deliberately excludes already-matched rows, so nothing else in the existing data already supplied date/party/amount for a matched transaction plus the specific `matchId` its Unmatch button needs — inventing that shape as a second query, grouped client-side by `bankLineId`, keeps `BankLineWithMatch` itself simple (just the id array named in the binding decision) rather than overloading one type with two different UI needs.
3. **The month-gate carve-out window is 12 days, anchored to `asOf` (today), not `monthEnd`.** Justified from the verified 2026-07-28 case (rows dated 6/24-6/25 cleared the bank 6/29, a 4-5 day lag) plus Zeffy's ~7-day remittance cycle, rounded up with margin. Anchoring to `asOf` (mirroring `hasMonthElapsed()`'s existing injectable-`asOf`, local-getter pattern in the same file) is not a preference but a correctness requirement the architect flagged explicitly (§5): a `monthEnd`-relative window would exclude a forgotten, never-remitted batch forever as real time passes, which fails the treasurer's stated requirement that a long-stale batch must still flag. The carve-out is threaded through **both** `isMonthGatedForEntity()` and `getLatestOpenMonthForEntity()`'s own `blockingDates` filter — omitting the second would reintroduce the exact candidate-picker-truncation bug already fixed once for outstanding checks.
4. **Correcting a wrong pick inside a committed batch is "unmatch every row down to zero, then re-pick the full corrected set," not "add the missing row back in isolation."** The existing "bank line already has a match → 409" gate in `match/route.ts` stays unchanged (architect §4: a line is matched once, as a complete set) — a partial per-row unmatch leaves the line "claimed" and unable to accept a new POST until every remaining match on it is also removed. Accepted as bounded v1 friction per the binding decision (per-row-only unmatch); a fast-follow that relaxes the gate to "reject only when the line is already balanced" is named as a reversible follow-up if real usage makes this painful.

**Rationale:** All four favor the shape that keeps exactly one code path per concern (one match-body shape, one query per new UI need, one gate-relaxation rule) over a shape that would require either a second request format, an overloaded read type, or an unbounded month-gate exclusion that could hide a broken sync indefinitely.

**Impact:** `src/lib/reconciliation-queries.ts` (`getTieOutAssembly`/`getBankLinesForSession` fan-out fix + `BankLineWithMatch.matchedTransactionIds: string[]`, new `getMatchedTransactionsForSession`/`MatchedTransactionRow`), `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts` (batch body + 9-step validation + atomic insert), `src/lib/financial-report-queries.ts` (`isInTransitZeffyDepositRow`, `daysBetween`, `asOf` threaded through `isMonthGatedForEntity`/`getLatestOpenMonthForEntity`), `src/components/admin/ledger/reconciliation-match-picker.tsx` (multi-select + running-sum + Zeffy filter chip), `src/components/admin/ledger/reconciliation-matching-grid.tsx` (expandable "Matched · N" + per-row unmatch), `src/components/admin/ledger/guide/reconciliation-section.tsx` §10. Full API contract, query rewrites, and the nine named unit tests are in the Phase 3 section of the work-log.

---

## DECISION-050: Monthly Financial Statement — exclude Quicken-imported rows from One-Month cash bucketing; no fund-picker route segment; Annual-Budget-column balance rows cut from v1

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Three implementation calls closing Phase 3 for `docs/work-log/2026-07-28-monthly-financial-report.md`, on top of DECISION-049's placement ruling:

1. **`computeOneMonthCashActuals()`'s `reconciledAt` fallback excludes Quicken-imported rows rather than mis-bucketing them.** `scripts/import-quicken-ledger.ts` sets `reconciledAt: t.reconciled ? new Date() : null` — every historical reconciled row's `reconciledAt` is the 2026-07-20 import run's timestamp, not a real bank-clear date. Phase 1/2's "fall back to `reconciledAt` for legacy rows" language, read literally, would bucket roughly a year's worth of historical transactions into whichever single calendar month the import happened to land in — a silent, materially wrong number on a feature whose entire premise is "these numbers must never look wrong." The importer already tags every row it writes with a `[quicken-import]` marker in `memo` (`buildMemo()`); the query layer checks for that literal marker (colocated as its own constant in `financial-report-queries.ts`, not imported from `scripts/` — one-off scripts aren't meant to be an app dependency) and excludes matching rows from the One-Month column entirely, surfacing `hasUndatedHistoricalRows` in the footer. These rows are unaffected in the Twelve-Month/Budget columns (txnDate/posted-basis via `getFundReport()`, untouched by this problem). Only true legacy per-row-toggle rows (a human's real-time click, no import marker) use the `reconciledAt`-date fallback as originally recommended.
2. **The `[entitySlug]/[month]` route has no fund segment.** The seed migration (`0044_ledger_books.sql`) creates exactly one fund per (entity, exposed-kind) — `club`/`administrative`, `foundation`/`charitable` — so "which fund" is fully determined by `entitySlug` today; a fund-picker would be a UI control with only one possible choice. `getMonthlyStatement()` still takes a resolved `LedgerFund` and re-checks its `kind` against the allowlist (architect's ruling), so this stays correct if a second exposed-kind is ever seeded — the route just doesn't expose a control for a choice that doesn't exist yet.
3. **The reference reports' Annual-Budget-column "Beginning fund balance"/"Ending fund balance" rows are cut from v1** (rendered as "—"). Checking the actual PDF numbers against `getFundReport()`'s rollforward math confirms this figure isn't derivable from anything in this schema — it's a separate, hand-tracked estimate the prior treasurer kept outside the books software (the Foundation PDF's Budget-column beginning, $29,569.30, matches neither the Twelve-Month column's beginning, $20,000.28, nor any value the rolled-forward-opening logic can produce). Building it would mean inventing a new persisted "budgeted beginning balance" input with no authoring UI in scope — the same class of problem Phase 1 already deferred for per-line notes. Reversible scope cut, not a technical wall; flagged to the user for sign-off alongside the divergence-footnote wording, not blocking Phase 4.

**Rationale:** All three favor catching a real, high-stakes correctness gap (item 1) and not inventing new persisted inputs with no authoring surface (items 2's non-issue and item 3) over reproducing the reference layout at the cost of either wrong numbers or undisclosed scope creep.

**Impact:** `src/lib/financial-report-queries.ts` (`computeOneMonthCashActuals`'s three-tier fallback, `hasUndatedHistoricalRows` flag), `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` (no fund route segment), `src/components/members/monthly-statement-table.tsx` (Annual Budget column renders "—" on the two balance rows). Full contract in the Phase 3 section of the work-log.

---

## DECISION-049: Monthly Financial Statement — new `financial-report-queries.ts` sibling module; extend `getFundReport()` with an `asOfDate` bound instead of duplicating its rollforward math

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-07-28-monthly-financial-report.md`. Two placement calls:

1. **`getFundReport(fundId, fiscalYear)` gains an optional third argument, `opts?: { asOfDate?: string }`**, narrowing the upper bound of its transaction query from "FY end" to `min(fyEnd, asOfDate+1 day)`. The FYTD-actuals, budget-variance, and rolled-forward book-balance figures the monthly statement needs are the *same figures* `getFundReport()` already computes for the admin Ledger — reimplementing that rollforward/budget/cause-line logic in a new function would create a second, independently-maintained path to numbers that must never disagree with what the admin sees. `asOfDate` is additive and optional; every existing call site (the admin fund-report page, budget editor) is unaffected because it's undefined there.
2. **A new sibling module, `src/lib/financial-report-queries.ts`**, holds everything that is genuinely new: the bank-cleared-date "One-Month" column (joining `ledgerTransactions` → `ledgerReconciliationMatches` → `ledgerBankLines.postingDate`, with the `reconciledAt`-fallback for legacy-toggled rows), the transaction-level reconciliation gate (generalizing `getOverview()`'s `unreconciledPriorMonth` predicate to an arbitrary month boundary instead of "today"), the divergence footnote between book balance and one-month cash net, and the member-exposed-fund allowlist (`fund.kind IN ('administrative','charitable')`). This mirrors the precedent already set by `reconciliation-queries.ts` being split from `ledger-queries.ts` (same file's own header cites that split as "a distinct feature surface built on top of the existing ledger_transactions table, not a rework of it") — the monthly statement is likewise a distinct read surface composing the existing engine, not a rework of it.

**Rationale:** The single most load-bearing risk this feature carries (per Phase 1) is member-visible numbers silently drifting from the admin Ledger's numbers. Keeping exactly one function responsible for "what does the book say FYTD/ending balance is" — extended, not forked — forecloses that risk at the architecture level rather than relying on discipline at the query-writing level. The bank-cleared-date lens has no existing home to extend (nothing in `ledger-queries.ts` today buckets by `postingDate`), so it gets a new file rather than being wedged into `getFundReport()` as an unrelated third concern.

**Impact:** `src/lib/ledger-queries.ts` — `getFundReport()` signature gains `opts?: { asOfDate?: string }` (additive, backward-compatible). New file `src/lib/financial-report-queries.ts` — exports a single entry point (name TBD by tech-lead, e.g. `getMonthlyStatement(fundId, year, month)`) returning a discriminated union (`{ status: 'gated' } | { status: 'ready', statement: ... }`) so "not yet reconciled" and "reconciled, zero activity" never collapse into the same shape. New route `src/app/members/financial-reports/...` (Server Components) and `src/components/members/` additions consume only this module's aggregated return type — never raw `ledgerTransactions` rows.

---

## DECISION-048: Labeled cause budget lines — API contract closing Phase 3 (id-dispatch on one route, no in-place cause change, insert-not-upsert on create, entity-scoped label autocomplete)

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Four implementation calls closing Phase 3 for `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`, left open by DECISION-047 ("exact HTTP verbs, request/response shapes, and the duplicate-`(cause,label)` error contract are tech-lead's call"):

1. **One route, dispatched by the presence of `id`, not a new endpoint.** `PATCH /api/admin/ledger/budgets/cause-lines` still handles both "create the first/next line" (no `id` in the body) and "edit an existing line's amount and/or label" (`id` present) — matching B-17's existing route-count discipline (DECISION-046) rather than adding a third route for what is, from the client's perspective, one form submitting either an add or a save.
2. **Cause is fixed at creation; there is no in-place cause change in this increment.** Phase 1 named exactly one edit verb for existing lines (label) and the binding decision's own wording scopes the single-`UPDATE` retirement of the delete+recreate hack to "edit-amount + edit-label" — not cause. Moving a line to a different cause is DELETE the old line + CREATE a new one, two calls that already exist, rather than a third mutable field on `UPDATE`. This narrows what B-17's shipped UI technically allowed (every committed row had a live cause `<select>`) — flagged explicitly to the user in the Phase 3 doc as a reversible scope cut, not a hard technical constraint, since adding `cause` as an optional third `UPDATE` field later is mechanically trivial (same collision-check codepath).
3. **`createBudgetCauseLine` is a plain `INSERT` with a pre-check, not `onConflictDoUpdate`.** B-17's shipped upsert silently merged a same-cause write into the existing row; under the new model that exact mechanism would silently merge two *distinct, differently-labeled* lines the moment a duplicate `(cause, label)` was submitted — precisely the failure this increment exists to prevent (architect's Phase 2 ruling, DECISION-047 item 3). A `SELECT`-then-`INSERT` gives a clean `409 duplicate_cause_label` in the common case; the `UNIQUE(budget_id, cause, label)` constraint is race-condition defense-in-depth, caught and mapped to the identical response. Seeding keeps upsert semantics (renamed to `upsertBudgetCauseLineForSeed`, hardcoded `label: ''`) since re-running "seed from last year" must still update an existing generic line, not 409 against itself.
4. **The `<datalist>` autocomplete source is scoped to the entity, not the single fund being edited.** `getBudgetCauseLineLabels(entityId)` joins `ledger_budget_lines → ledger_budgets → ledger_funds` and filters on `entity_id`, read once per page load and shared across every `BudgetEditor` instance on that page (both `budgeting/page.tsx`, which renders all of an entity's funds at once, and `[fundSlug]/report/page.tsx`, which renders one). A label used under a sibling fund in the same entity (e.g. Foundation's charitable fund and its scholarship fund) is a reasonable suggestion even for the fund currently being edited — it's an optional autocomplete hint, not a constraint, so an irrelevant suggestion is harmless where a missed one would undermine the whole point of offering consistency across entries.

**Rationale:** All four favor the smallest new surface that satisfies DECISION-047's binding shape (id-keyed writes, `NOT NULL DEFAULT ''` label, one blank per cause) over inventing new endpoints, new mutable fields, or a narrower autocomplete scope that Phase 1's own Gap 8 ("WARM" vs "W.A.R.M." vs "Warm Inc" drifting *across categories or fiscal years*) already argued against.

**Impact:** `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine` split into `createBudgetCauseLine`/`updateBudgetCauseLine`, `deleteBudgetCauseLine` re-keyed to `id`, the former upsert renamed `upsertBudgetCauseLineForSeed` and its conflict target widened to three columns, new `getBudgetCauseLineLabels`), `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (id-dispatch, `reason` now on the wire), `src/app/api/admin/ledger/budgets/seed/route.ts` (one-line call-site rename), `src/components/admin/ledger/budget-cause-editor.tsx` (cause `<select>` only on never-saved rows; grouped-by-cause display for committed ones). Full request/response shapes and the ten named unit tests are in the Phase 3 section of the work-log.

---

## DECISION-047: Labeled cause budget lines — `label` column shape, constraint swap on a populated table, id-keyed write model

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Three structural calls closing Phase 2 for `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md` (B-17 follow-up, relaxing DECISION-045's `(budgetId, cause)` uniqueness to allow multiple labeled lines per cause):

1. **`label` is `TEXT NOT NULL DEFAULT ''`, not nullable.** The binding functional rule (Chris, 2026-07-28) is "one blank label per cause, plus any number of distinctly-labeled lines" — that requires blank to be a real, collidable value. Postgres unique constraints treat `NULL <> NULL`, so a nullable `label` column under a plain `UNIQUE(budget_id, cause, label)` constraint would silently *allow* unlimited blank-label duplicates per cause — exactly the case that must be blocked. `NOT NULL DEFAULT ''` makes blank an ordinary string that collides with itself, so the existing v1.40.0 rows (which get backfilled to `label = ''` by the same `ADD COLUMN ... DEFAULT ''` statement, metadata-only under Postgres's fast-default path) become each cause's one legitimate "generic" line without any explicit backfill loop.
2. **Uniqueness is a plain composite constraint, `UNIQUE(budget_id, cause, label)` — no partial or expression index.** Because `label` can never be `NULL` under Item 1, a `COALESCE(label, '')`-based partial/expression unique index would be solving a problem that no longer exists; it adds a second, less-obvious mechanism for zero benefit over the plain constraint. The migration swaps the existing `ledger_budget_lines_budget_cause_key` (on `(budget_id, cause)`) for a new `ledger_budget_lines_budget_cause_label_key` (on `(budget_id, cause, label)`). Order of operations, all idempotent so the migration is safe to replay on every deploy: (a) `ALTER TABLE ... ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''` — must run first, since the new constraint references the column; (b) drop the old constraint guarded by `IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)`; (c) add the new constraint guarded by the equivalent `IF NOT EXISTS` check. This is safe against the live populated table (both dev and production carry v1.40.0 rows) because the *old* constraint was actively enforced the entire time those rows were written — no two existing rows share `(budget_id, cause)`, so they trivially satisfy the new, stricter `(budget_id, cause, label='')` constraint too; the swap cannot produce a duplicate-key error against existing data.
3. **Row identity moves from `(budgetId, cause)` to the line's own `id` for every write.** `upsertBudgetCauseLine`'s cause-keyed `onConflictDoUpdate` and `deleteBudgetCauseLine`'s cause-keyed lookup both stop being viable the moment a cause can have more than one row — cause is no longer sufficient to address a specific line. Create (no id yet) stays close to today's shape (resolve/create the parent `ledger_budgets` row, then insert the child, validating the new `(cause, label)` uniqueness server-side as a 409/400 rather than relying on `onConflictDoUpdate` to silently merge two distinct lines). Edit-amount and edit-label both become a single `UPDATE ledger_budget_lines SET ... WHERE id = $1` — no more delete-then-recreate, which retires the narrow "line transiently gone" failure window `budget-cause-editor.tsx`'s cause-rename path carried in B-17 Increment A. Delete becomes `DELETE ... WHERE id = $1`. All three still resolve the parent's `entityId`/`fiscalYear` via a join back to `ledgerBudgets` for `assertBudgetUnlocked()` — the lock check is unaffected in substance, only in how the row is found first.

**Rationale:** All three favor the shape that is correct by construction over a shape that requires the write path to remember an extra rule. A `NOT NULL DEFAULT ''` column plus a plain composite unique constraint enforces "one blank per cause" at the database level with no special-cased query logic; an id-keyed write model matches the row's actual identity now that two rows can share every other field, and eliminates a known, previously-disclosed class of bug (delete+recreate as a stand-in for rename) rather than doubling that risk onto a second editable field (label).

**Impact:** `src/lib/db/schema.ts` (`ledgerBudgetLines`: new `label` column, constraint renamed to `ledger_budget_lines_budget_cause_label_key` on `(budgetId, cause, label)`), a new idempotent migration under `drizzle/migrations/` (next number after `0063_ledger_budget_lines.sql`), `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine`/`deleteBudgetCauseLine` split into id-keyed create/update/delete operations), `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (request/response shapes gain `id` and `label`), `src/components/admin/ledger/budget-cause-editor.tsx` (rows keyed by `id` once committed; cause-rename-via-delete+PATCH path removed in favor of in-place label/amount edits). Exact HTTP verbs, request/response shapes, and the duplicate-`(cause,label)` error contract are tech-lead's call in Phase 3.

---

## DECISION-046: Cause-tagged budget line items — API surface (no "enter breakdown" endpoint; a dedicated collapse endpoint; seed extension is additive; category eligibility predicate)

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Four implementation calls closing the Phase 3 design for `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17 Increment A), left open by DECISION-045's schema/taxonomy ruling:

1. **Entering breakdown mode has no dedicated server endpoint.** The generic `PATCH /api/admin/ledger/budgets/cause-lines` upsert route doubles as the entry point for a category's first cause line. "Preserving the existing lump-sum amount as one `Other community support` line" (Human Answer 4) is a **client-side pre-fill**: clicking "Break down by cause" flips local component state to show one row pre-filled with `cause: OTHER_COMMUNITY_SUPPORT_CAUSE` and `amountCents` = the category's current lump-sum value, and nothing is written until that row commits via the normal blur/Enter pattern. Rejected alternative: a dedicated `POST .../cause-lines/enter-breakdown` endpoint that reads the current lump sum server-side and writes the first line atomically — this would be more "transactionally honest" (no window where the UI shows a pending conversion that hasn't saved), but it's a second endpoint and a second code path for behavior the existing `BudgetEditor` UX (nothing saves until blur/Enter, same as every other row in this editor) already covers correctly. If real usage shows treasurers losing the pre-filled row by navigating away, revisit.
2. **Collapsing breakdown → lump-sum (`POST .../cause-lines/collapse`) does not recompute the parent total — it deletes the children and leaves `ledger_budgets.annualAmountCents` untouched.** This works *because* every prior write already maintains "parent total = sum of children" as a standing invariant, so the parent's stored number is already correct the instant before collapse. No separate summing step is needed or safer than trusting the invariant.
3. **`POST /api/admin/ledger/budgets/seed` is extended additively (`seedCauseLines?: boolean`, default `false`), not split into a second route.** Cause-line seeding reuses the exact same `db.transaction()` as the existing category-level seed loop — a lock rejection partway through must roll back both lump-sum and cause-line writes atomically via the existing `SeedLockedError` pattern, which only holds if they share one transaction.
4. **Category eligibility for showing the "Break down by cause" affordance is `flow === "expense" && categoryCountsAsGiving === true`** (fund-kind eligibility is implicit — `BudgetEditor` only ever renders one fund's categories). This extends Phase 1 Gap 2's picker-level exclusion of the "Fundraising event costs" *cause value* to the category level too: a category already flagged `countsAsGiving = false` (ops, insurance, fundraising overhead — DECISION-030) has no giving-cause story to tell, so it shouldn't offer the picker at all. This is a functional extension beyond what Phase 1/2 explicitly ruled on, not a re-litigation of either — flagged in the Phase 3 doc so it's visible and reversible (one predicate change) if the user wants breakdown offered more broadly.

**Rationale:** All four favor the smallest number of new endpoints/branches that still satisfy the bound Phase 1/2 requirements, reusing `BudgetEditor`'s existing "nothing saves until commit" UX and the seed route's existing single-transaction/rollback pattern rather than inventing parallel ones.

**Impact:** `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (new, PATCH + DELETE), `src/app/api/admin/ledger/budgets/cause-lines/collapse/route.ts` (new, POST), `src/app/api/admin/ledger/budgets/seed/route.ts` (extended), `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`, `computeCauseSeedForCategory`), `src/components/admin/ledger/budget-editor.tsx` and the new `budget-cause-editor.tsx`. Full request/response shapes and the unit-test list are in the Phase 3 section of the work-log.

---

## DECISION-045: Cause-tagged budget line items — taxonomy promoted to `src/lib/ledger.ts`, `ledger_budget_lines` child table over a nullable-cause column

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Two structural calls closing Phase 2 for `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17 Increment A), left open by Phase 1 (analyst Gap 3, Gap 4):

1. **The cause taxonomy's runtime home is `src/lib/ledger.ts`**, as a new exported const array (the 9-value list minus `"Fundraising event costs"`, i.e. 8 real causes) plus the literal `"Other community support"` re-exported from the same module — not re-typed — so it round-trips exactly with `bucketGivingByCause()`'s existing null-cause label. `ledger.ts` has zero imports today (pure functions, no DB access) and is already the home for every other cross-cutting Ledger pure helper (`validateBudgetLineInput`, `isBudgetLocked`, `deriveSeedLinesForFund`, `bucketGivingByCause`) — it is both server- and client-importable, which a cause picker component and a server-side 400-rejection check both need from the same source. A validator (`isValidBudgetCause` or equivalent) ships alongside it, mirroring `validateBudgetLineInput`'s pattern. `scripts/import-quicken-ledger.ts`'s `deriveCause()` keeps its own matching *rules* (payee/memo/category → cause) but should import the *value* consts from `ledger.ts` in Phase 4 rather than maintaining a second private copy of the same strings — one taxonomy, not two that must be kept in sync by convention. B-18 (structured cause on transactions/reimbursements) reuses this exact same const and validator; no second re-home.
2. **Schema shape: a `ledger_budget_lines` child table, FK'd to `ledger_budgets.id`** (cascade delete), not a nullable `cause` column added to `ledger_budgets` itself. Recommended shape: the existing `ledger_budgets` row stays the rolled-up total for its `(fundId, fiscalYear, categoryId, flow)` tuple — read by every existing consumer (`getFundReport`, `budgetVariance`, guided-budgeting seed) completely unmodified — while `ledger_budget_lines` rows hold the cause-level detail. Any write to a category's cause lines is one transaction that upserts/deletes the child rows *and* recomputes `ledger_budgets.annualAmountCents` as their sum, funneled through the existing `upsertBudgetLine()`/`assertBudgetUnlocked()` core (or a sibling that shares its transaction and lock check) — not a second, independent enforcement point. "Breakdown mode" is not a separate boolean; it is simply "this budget row has 1+ child rows." Emptying a category to zero cause lines deletes the parent `ledger_budgets` row too, mirroring today's existing `annualAmountCents: null` → delete-the-row behavior exactly, so "no target set" only ever has one representation regardless of which mode produced it. Uniqueness: `(budgetId, cause)` on the child table — sufficient to satisfy "one line item per (cause, category, FY, flow)" because `budgetId` already uniquely identifies that tuple via `ledger_budgets_fund_year_cat_flow_key`. `cause` stays free `text`, validated at the app layer against the Item 1 taxonomy — no DB CHECK/enum, consistent with DECISION-041's precedent for this codebase's other app-layer-enforced text fields (`ledger_transactions.status`, `beneficiary_cause` itself).

**Rationale:** The child-table shape structurally prevents the lump-sum/breakdown ambiguity Phase 1 Flow 3 flagged (a single row can never simultaneously mean "the one target" and "one of several targets" for the same tuple), and keeping `ledger_budgets.annualAmountCents` as an always-current rolled-up cache means zero changes are required to any existing report/variance/seed read path in this increment — the blast radius stays contained to the new write path and the new UI, not every consumer of budget totals. The taxonomy's home in `ledger.ts` follows the file's own established convention (every other shared, pure, cross-cutting Ledger helper already lives there) rather than inventing a new module for a single const array.

**Impact:** `src/lib/db/schema.ts` (new `ledgerBudgetLines` table, added before its matching migration), a new idempotent migration under `drizzle/migrations/`, `src/lib/ledger.ts` (taxonomy const + validator), `src/lib/ledger-queries.ts` (new write/read functions alongside `upsertBudgetLine`/`assertBudgetUnlocked`), `scripts/import-quicken-ledger.ts` (Phase 4 refactor to import the shared consts instead of its own private copies). Full DDL, function signatures, and API contract are tech-lead's call in Phase 3 — this decision fixes the shape, not the column list.

---

## DECISION-044: Budget approve/lock API surface — route names, no chained category+amount write, lock state read via query function not a GET route, re-lock requires explicit unlock first

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Four implementation calls closing the Phase 3 design for `docs/work-log/2026-07-27-ledger-budget-approve.md`, all left open by the architect (Phase 2, Suggestions 1 and 3):

1. **Route names:** `POST /api/admin/ledger/budget-approvals` (approve/lock) and `POST /api/admin/ledger/budget-approvals/unlock` (unlock) — not nested under `/budgets/`, since `ledgerBudgetApprovals` is its own resource keyed by `(entityId, fiscalYear)`, not a budget line.
2. **`POST /api/admin/ledger/categories` does not accept an inline `annualAmountCents`.** Creating a category and setting its first dollar amount stay two separate calls (`POST /categories` then the client's existing `PATCH /budgets` on blur, unchanged) rather than one endpoint doing both. A brand-new category is created with no budget line at all — it appears in `BudgetEditor` as an empty-amount row ready to type into, matching Phase 1 Flow 1's stated outcome exactly. Chaining would mean the categories route re-implements amount validation that already lives in `validateBudgetLineInput`/`upsertBudgetLine`, for a save-two-round-trips optimization on an occasional, low-cardinality action (a few new categories per year, per Phase 1's own cadence estimate).
3. **No new `GET` route for lock state.** `budgeting/page.tsx` is a Server Component that already fetches every other piece of page data (`getFunds`, `getFundReport`, `computeSeedFromPriorYear`) by calling `ledger-queries.ts` functions directly, never through an internal API round-trip. The new `getBudgetApproval(entityId, fiscalYear)` query function follows that existing convention rather than introducing the first internal-fetch GET route on this page.
4. **Re-approving an already-locked `(entityId, fiscalYear)` returns `409`, not a silent overwrite.** Locking a second time without first calling unlock is rejected with `"This budget is already locked. Unlock it to make changes and re-approve."` — this forces the explicit unlock-then-relock sequence Phase 1's Flow 5 describes (reason captured, then re-approve) rather than letting a second `POST /budget-approvals` quietly replace the first approval's trio and erase which board vote is actually on record.

**Rationale:** All four choices favor matching an existing convention already established elsewhere in this file/module over inventing a new one for a feature that fires a handful of times per year. See Impact for the specific files each affects.

**Impact:** `src/app/api/admin/ledger/budget-approvals/route.ts` (approve), `src/app/api/admin/ledger/budget-approvals/unlock/route.ts` (unlock), `src/app/api/admin/ledger/categories/route.ts` (create, no amount param), `src/lib/ledger-queries.ts` (`getBudgetApproval`, no corresponding route), `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (calls `getBudgetApproval` directly). Full contracts in Phase 3 of the work-log.

---

## DECISION-043: Budget approve/lock modeled as a single status-flip row per (entity, fiscalYear), not an event log

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** The new `ledger_budget_approvals` table (Phase 2 architectural review, `docs/work-log/2026-07-27-ledger-budget-approve.md`) is **one row per `(entityId, fiscalYear)`**, unique-constrained on that pair, carrying a `status` column (`'locked' | 'unlocked'`, default `'unlocked'`) plus current-state approval fields (`approvedByUserId`, `approvedAt`, `boardMinute`) and current-state unlock fields (`unlockedByUserId`, `unlockedAt`, `unlockReason`). Locking updates the approval trio and flips `status`; unlocking updates the unlock trio and flips `status` back — **neither action clears the other's fields**, so the most recent lock and the most recent unlock are both visible at once even after several lock/unlock cycles. This is **not** an append-only event log of every lock/unlock action.

**Rationale:** This mirrors the codebase's existing convention exactly rather than inventing a new one: `ledgerTransactions` (approval) and `ledgerReimbursements` (submit/approve/reject/pay) both model approval state as nullable current-state columns on a single row, never as a separate audit-event table — and there is no generic audit-log table in this schema to reuse (`googleGroupSyncLog` is sync-specific, not a generic audit mechanism). Budget adoption is a once-a-year, low-cardinality board action; an event-log table would add a second table, a list query, and a list UI for an action that fires a handful of times a year at most, with no stated requirement for a full history beyond "the most recent unlock is visible" (Phase 1, analyst). If a future increment needs full multi-cycle audit history, that's a new, separately-scoped feature — not a reason to over-build this one.

**Impact:** `src/lib/db/schema.ts` gets a new `ledgerBudgetApprovals` table; a matching idempotent migration (`drizzle/migrations/0062_ledger_budget_approvals.sql` or next available number) creates it and leaves existing `ledger_budgets` untouched. `assertBudgetUnlocked(entityId, fiscalYear)` (new shared guard) reads this table's `status` column. Follow-up: if the club later wants a full lock/unlock history (e.g., for 990 audit trail), add an event-log table then — don't retrofit this one to serve two shapes.

---

## DECISION-042: Guided budgeting — Activity fund balance tolerance set to ±$100

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** `computeBudgetBalanceStatus()` (`src/lib/ledger.ts`, guided-budgeting increment) treats the Activity fund as balanced (`status: "ok"`) whenever `|budgetedIncomeCents - budgetedExpenseCents| <= 10_000` (±$100), and `warn` outside that band. Administrative uses a strict `income < expense` rule (no tolerance); Charitable/Scholarship are always `info` (planned drawdown is legitimate, never `warn`).

**Rationale:** Locked product decision 4 (Phase 1/2 of `docs/work-log/2026-07-27-ledger-guided-budgeting.md`) specified "Activity warns if net ≠ ~$0 (tolerance TBD — tech-lead specifies)" — the numeric value itself was left to Phase 3. The Activity fund is a pass-through clearing account for publicly-raised charitable money; "balanced" means planned receipts ≈ planned disbursements, not an exact-zero requirement. A treasurer hand-entering roughly a dozen category lines, each realistically rounded to the nearest $25–$50, will rarely land on an exact $0 net by design — a flat-dollar band absorbs that entry-level rounding noise without masking a genuine four-figure planning gap. Chosen as an absolute-dollar threshold (not a percentage of budget size) because the Activity fund's "near zero" target doesn't scale with fund size the way an operating-budget ratio would.

**Impact:** `src/lib/ledger.ts` — `computeBudgetBalanceStatus()`. Unit-tested at the boundary (net = exactly $100 → `ok`; net = $100.01 → `warn`; symmetric on the deficit side) in `src/lib/ledger.test.ts`. This is a starting default, not a number validated against a real budgeting season yet — flagged to the treasurer as adjustable after first use if it proves too tight or too loose. Presentation-only: never blocks a save, never stored.

---

## DECISION-041: Prospective members — no DB-level CHECK constraint for the `isActive`/`membershipStatus` invariant; application-level enforcement only

**Status:** Resolved
**Date:** 2026-07-26

**Decision:**

Adding `members.membershipStatus` (`prospective | active | ended`) per the prospective-members feature (`docs/work-log/2026-07-26-prospective-members.md`), the architect flagged a DB-level `CHECK` constraint enforcing `is_active = (membership_status = 'active')` as an optional hardening suggestion, noting no CHECK-constraint precedent existed in `drizzle/migrations/`. Declining it: this codebase already has an on-the-record decision *against* CHECK constraints on status-like text columns — `src/lib/db/schema.ts` lines 935, 958, and 1018 each carry `"No CHECK constraint on status — consistent with ledger_transactions.status pattern (inc1 precedent)"`. The invariant is enforced entirely in application code: every write path (`POST`/`PATCH /api/admin/members`, both membership-application approval branches, the roster-import scripts) derives `isActive` from `membershipStatus` via a single shared helper (`isActiveForStatus()` in `src/lib/members.ts`), never accepts a client-submitted `isActive`, and the invariant is regression-guarded by unit tests in `src/lib/members.test.ts`.

**Rationale:**

Adding a CHECK constraint here would introduce a new pattern this codebase has explicitly decided against elsewhere, not extend an existing one. It would also create an unrepresented-in-`schema.ts` database object to reason about on every future schema change — this project's Drizzle models have no first-class CHECK-constraint builder in use anywhere, and the invariant "`schema.ts` is the source of truth; anything in the live DB that isn't in `schema.ts` is dropped on the next `pnpm db:push`" makes an object Drizzle doesn't know about a standing risk, for a guarantee the application-level helper already provides. The partial unique index added in migration 0042 (`dues_settings`, similarly unrepresented in `schema.ts`) has run safely in production since — precedent that an unmanaged raw-SQL object is survivable, but that doesn't make adding a *second* undeclared kind of object (a CHECK constraint, a category this codebase has never used) the right default.

**Impact:**

`drizzle/migrations/0061_members_membership_status.sql` adds the column and backfill only, no CHECK constraint. `src/lib/members.ts` centralizes the invariant in `isActiveForStatus()`, `shouldProvisionOnMemberCreate()`, `shouldProvisionOnMemberUpdate()` — every write path must route through these, not reimplement the logic inline. If a future incident shows application-level enforcement was insufficient (e.g., a write path bypasses the helper), revisit this decision then, with that incident as the concrete justification a hypothetical one doesn't provide today.

---

## DECISION-040: Receipt storage moves to Postgres — `DatabaseReceiptStorage` adapter, `NODE_ENV`-gated selection (no new required env var), `@vercel/blob` removed

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Add a third `ReceiptStorage` adapter, `DatabaseReceiptStorage`, backed by a new
dedicated table `ledger_receipt_files` (bytes live off the hot ledger/reimbursement/
acknowledgment rows, keyed by the existing opaque `receipts/<uuid>/<name>` key —
DECISION-020's key format is unchanged). `getReceiptStorage()`'s selection rule
changes from "`BLOB_READ_WRITE_TOKEN` present → Blob" to:

```
process.env.NODE_ENV === "production" → DatabaseReceiptStorage
otherwise (development, test)          → LocalReceiptStorage
```

**No new environment variable, in production or anywhere else.** `NODE_ENV` is
platform-set by `next build`/`next start` (true on every Vercel-hosted deployment —
Production *and* Preview, both of which share the same `DATABASE_URL` and neither
of which has a writable persistent filesystem) and by Vitest/Playwright/`pnpm dev`
for the other branch — never a value an operator manually configures per
environment, so it cannot be silently left unset the way `BLOB_READ_WRITE_TOKEN`
was. `LocalReceiptStorage` remains the zero-config dev/test adapter, and the
factory's `.receipt-store/` path never activates in any Vercel-built runtime.

`@vercel/blob` is dropped from `package.json`; `src/lib/receipt-storage/vercel-blob.ts`
is deleted outright, not kept behind a dead branch. The external dependency,
the token requirement, and the Hobby-plan Blob cap are fully eliminated, matching
the user's stated decision.

**Table shape** (`schema.ts` first, then an idempotent migration):

```ts
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

export const ledgerReceiptFiles = pgTable("ledger_receipt_files", {
  key: text("key").primaryKey(),               // receipts/<uuid>/<name> — DECISION-020 format
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

This is the first use of Drizzle's `customType` in this codebase (no prior binary
column exists); it is not a new dependency — `customType` ships in `drizzle-orm/pg-core`,
already installed. A separate table (not a `bytea` column inline on
`ledger_transactions` / `ledger_reimbursements` / `ledger_acknowledgments`) keeps
those hot, frequently-`SELECT *`'d tables narrow — same reasoning that already
produced `ledgerFilings`, `ledgerReconciliationMatches`, etc. as side tables rather
than columns bolted onto a busy parent. Naming follows the `ledger_*` family since
100% of current consumers (ledger transactions, reimbursements, acknowledgment
letters) are Ledger-domain features. No `CHECK` constraint on `key`'s format,
consistent with this codebase's precedent of validating enum/pattern-shaped
columns at the app layer only (`ledger_transactions.status`, `ledger_reimbursements.status`).
10 MB receipts are trivial for Postgres `bytea`/TOAST and for `postgres.js`'s
message handling — no config changes needed.

`DatabaseReceiptStorage.save()` is `INSERT ... ON CONFLICT (key) DO UPDATE SET
content_type = excluded.content_type, bytes = excluded.bytes, byte_size =
excluded.byte_size` — preserves the interface's upsert semantics (matches Blob's
`allowOverwrite: true`, Local's unconditional `writeFileSync`). `read()` returns
`null` on a missing key (never throws); `delete()` is a no-op on a missing key
(never throws). The `ReceiptStorage` interface itself does not change.

**Two pre-existing defects are folded into this work, not deferred:**

1. **Orphan-bytes on receipt remove/replace** — `src/app/api/admin/ledger/transactions/[id]/route.ts`
   (~line 355) nulls `receiptStorageKey` without calling `getReceiptStorage().delete()`
   on the old key. Harmless under disposable Blob storage; becomes permanent,
   unbounded row growth inside the primary database once bytes live in Postgres.
   The acknowledgment-letter route already deletes-then-saves correctly — this
   fix makes the transaction-receipt path match the codebase's own established
   pattern. In scope for Phase 4, on the exact file this change touches.
2. **Byte-corruption guard adoption gap** — `receiptBytesToBodyInit()` is only
   called by 2 of 4 read routes; `acknowledgments/[id]/letter/route.ts` (line 77)
   and `members/reimbursements/[id]/receipt/route.ts` (line 50) still do the
   unguarded `stored.bytes.buffer` pattern. This project's DB driver is
   `postgres.js` (`drizzle-orm/postgres-js`), not `pg`/node-postgres — `postgres.js`
   decodes `bytea` via `Buffer.from(hexString, "hex")`, which is subject to the
   same small-allocation pooling behavior as `fs.readFileSync` (nonzero
   `byteOffset` into a shared pool ArrayBuffer for buffers under
   `Buffer.poolSize >> 1`). The exact bug class the guard exists for is reachable
   again on the new byte source, not just theoretically. Both remaining call
   sites route through `receiptBytesToBodyInit()` as part of this work, before
   the byte source changes underneath them.

Both are small, sit directly on files this change already modifies, and get
strictly worse (defect 1) or newly live again (defect 2) as a direct result of
the byte-source swap — bundled here rather than spun into separate bug-fix
work-log entries.

**Rationale:**

The user's whole motivation is eliminating a required-env-var-in-production
footgun (`BLOB_READ_WRITE_TOKEN` unset → silent fallback to `LocalReceiptStorage`
→ `fs.writeFileSync` on Vercel's read-only FS → 500 on every receipt upload).
`DATABASE_URL` is present in every environment, so naive "DB present → DB adapter"
logic was considered and rejected — it would force the DB adapter into local dev
and any future test that calls the factory, killing the zero-config `.receipt-store/`
dev experience and risking real network+DB round-trips in unit tests. An explicit
opt-in var (e.g. `RECEIPT_STORAGE=database`) was also rejected — it reintroduces
the exact same footgun class it's meant to replace: a manually-set flag that can
be forgotten, and forgetting it would silently reselect `LocalReceiptStorage` in
production, breaking uploads in exactly the way that triggered this work. Dropping
`LocalReceiptStorage` entirely (DB always) was rejected too — it would require a
reachable `DATABASE_URL` before any local contributor or CI run could exercise
receipts, with no adapter this project has ever built to mock that boundary.
`NODE_ENV === "production"` is the only signal that is both automatic (never a
human's job to set) and precisely correlated with "no persistent writable
filesystem is available" — which is the actual constraint driving adapter choice,
not the vaguer "are we in prod."

**Impact:**
- New: `src/lib/receipt-storage/database.ts` (`DatabaseReceiptStorage`).
- Removed: `src/lib/receipt-storage/vercel-blob.ts`; `@vercel/blob` dropped from `package.json`.
- `src/lib/receipt-storage/index.ts`: factory selection rule changes to the
  `NODE_ENV` check above; the FU-6 "warn in production, falling back to Local"
  log line is removed (Local can no longer be selected in production).
- `schema.ts` gains `bytea` customType export + `ledgerReceiptFiles` table; a new
  idempotent migration adds `CREATE TABLE IF NOT EXISTS ledger_receipt_files (...)`.
- `src/app/api/admin/ledger/transactions/[id]/route.ts`: Flow D gains a
  `getReceiptStorage().delete(oldKey)` call.
- `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` and
  `src/app/api/members/reimbursements/[id]/receipt/route.ts`: route reads through
  `receiptBytesToBodyInit()`.
- No data migration — no existing production receipts to move (user-confirmed;
  uploads have been failing since v1.31 shipped).
- No `FEATURES` change — this is a backend adapter swap, permissions are
  unaffected.
- Refines DECISION-020 (adapter selection rule and adapter roster both change;
  the `ReceiptStorage` interface and opaque-key/proxy-route model are unchanged
  and remain authoritative).

---

## DECISION-039: HEIC WASM decoder swap — `libheif-js` (`wasm-bundle` subpath) replaces `heic2any`, main-thread decode, no `next.config.ts` change

**Status:** Resolved
**Date:** 2026-07-21

**Decision:** Replace `heic2any` with `libheif-js@^1.19.8`, imported
exclusively via its `libheif-js/wasm-bundle` subpath
(`import("libheif-js/wasm-bundle")`), in `src/lib/heic-decode.ts`. Same
trigger condition as DECISION-038 (only after a native
`createImageBitmap()` failure on a HEIC/HEIF file in
`receipt-file-input.tsx`) and the same dynamic-`import()`-only,
own-async-chunk shape — Safari and every successful native-decode path
still never fetch it. `heic2any` is removed outright; no dual-decoder
fallback.

**Rationale:** `heic2any@0.0.4` embeds a `libheif` WASM build too old to
parse modern iPhone HEIC (10-bit `heix` + HDR gain-map `tmap`, 48 MP) —
reproduced against a real user photo (decode failure in 201 ms,
`Could not parse HEIF file`) in
`docs/work-log/2026-07-21-heic-modern-iphone-decode.md`. It's also
unmaintained since ~2021 with no newer release, so there's no "wait for
an update" option. `libheif-js@1.19.8` decodes the same file correctly
(independently re-verified in this review: 787 ms, correct 4284×5712
dimensions, non-blank RGBA output), is actively maintained (last
published 2025-06-12, steady history since 2020, explicit policy of
tracking upstream `libheif`), and carries zero transitive runtime
dependencies (strictly better than the `heic-decode` package DECISION-038
rejected for depending on `libheif-js` transitively — this decision takes
it directly instead).

`libheif-js` ships three entry points; unpacked the real tarball rather
than trusting the README. The default `libheif-js` import (2.1 MB,
"classic pure-JS" build) and the `libheif-js/wasm` split-asset entry
(Node-only `fs.readFileSync` of a separate `.wasm` file — no browser
story, would need real asset-pipeline config this project doesn't carry)
were both rejected. `libheif-js/wasm-bundle` (1.4 MB raw / ~521 KB gzip)
inlines its WASM as base64 in the JS — verified directly, no separate
`.wasm` fetch — the same packaging property that made `heic2any`
viable under DECISION-038's "no asset-pipeline/CSP changes" requirement.
Modest size increase over `heic2any` (~180 KB gzip) accepted as the cost
of a decoder that actually decodes the target files; it's still a single
lazy chunk under the same gate.

`libheif-js` decodes on the calling thread (no internal Worker, unlike
`heic2any`'s Blob-backed Worker). Re-verified 787 ms for the reproduction
file. Ruled acceptable for now without a Worker wrapper: the receipt
upload UI already shows a "Preparing photo…" state and disables the file
input during decode, this is an authenticated-treasurer, occasional-use
admin flow (not public or latency-sensitive), and a Worker wrapper would
add real marshaling complexity for a UX gain not currently needed.
Revisit if decode times grow or main-thread contention becomes an issue —
not filed as a backlog item by this decision, flagged in the work-log for
whoever hits it next.

**License class, addressed explicitly per this decision's own review
criteria:** `libheif-js`'s own `package.json` now declares
`"license": "LGPL-3.0"` directly for the wrapper (one notch stricter than
`heic2any`'s MIT-wrapper-around-LGPL shape — same underlying compiled
`libheif` either way, LGPL-3.0, unchanged from DECISION-038). DECISION-038's
acceptability reasoning applies unchanged: consumed unmodified as an npm
dependency (ordinary LGPL linking/consumption, not the modify-and-
redistribute case LGPL's copyleft targets), used strictly client-side,
decode-only, inside a small nonprofit's internal admin tool by an
authenticated treasurer converting a receipt photo they already possess —
not a commercial product, not redistributed as a standalone artifact. If
this judgment is ever revisited, the removal surface is still a single
dynamic-import call site. Zero transitive runtime dependencies, confirmed
by inspecting the installed package's `package.json` (no `"dependencies"`
key).

**Impact:** `package.json`: `heic2any` removed, `libheif-js@^1.19.8`
added. `src/lib/heic-decode.ts`: decoder call replaced; new RGBA→JPEG
canvas-encode glue added inside this file (libheif-js hands back raw
pixel data via `image.display()`, not a Blob) — lives here rather than in
`image-resize.ts` because that module owns *resizing an already-decoded
image*, a different concern from *encoding a decoder-specific raw pixel
buffer*; folding it in there would leak a decoder-specific data shape
into a module whose callers only ever hand it images/Blobs. Public
contract of `heic-decode.ts` is unchanged
(`decodeHeicFileToJpegBlob(file): Promise<Blob>`, `HeicDecodeStageError`,
stages `"chunk-load"`/`"decode"`, `classifyHeicDecodeFailure`, messages)
— `receipt-file-input.tsx` requires zero changes. No `next.config.ts`
change; no schema, route, or `FEATURES` change. Full reasoning, entry-
point comparison table, and implementation sketch in the Phase 2/3
sections of
`docs/work-log/2026-07-21-heic-modern-iphone-decode.md`.

---

## DECISION-038: HEIC WASM decode fallback — `heic2any` (MIT wrapper, embeds LGPL-3.0 libheif WASM), client-only, no `next.config.ts` change

**Status:** Superseded by DECISION-039 (dependency choice only — the
trigger condition, dynamic-import-only shape, and "own async chunk, never
loaded by Safari" invariant this decision established all still stand)
**Date:** 2026-07-21

**Decision:** Add `heic2any@^0.0.4` as the WASM HEIC decoder for
`docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md`, chosen over
`libheif-js` and `heic-decode`. Dynamically imported (`import("heic2any")`)
from a new `src/lib/heic-decode.ts` module, itself imported only by the
existing client component `src/components/admin/ledger/receipt-file-input.tsx`
— triggered exclusively after a native `createImageBitmap()` failure on a
HEIC/HEIF file, so it never loads for Safari or for any successful
native-decode path. No schema, no server route, no `FEATURES` key, no
`next.config.ts` change.

**Rationale:** All three Phase 1-named candidates wrap the same underlying
decoder (libheif compiled to WASM); the choice came down to packaging and
API fit, verified by unpacking each tarball rather than trusting READMEs.
`heic2any`'s bundle embeds its WASM inline (no separate `.wasm` asset file,
instantiated inside a `Blob`-backed `Worker`), which is what makes the
"no bundler/asset-pipeline config needed" property true — the two
lower-level candidates consume libheif's raw Emscripten output and would
carry asset-loading risk this project's `next.config.ts` isn't currently
configured for. `heic2any` also has the best API fit: File/Blob in, JPEG
Blob out, feeding straight back into the existing `resizeImage()` canvas
pipeline in `image-resize.ts` without new pixel-buffer glue. Zero
transitive npm dependencies (`heic-decode` carries one: `libheif-js`).

**License class, addressed explicitly per this decision's own review
criteria:** `heic2any`'s own code is MIT (verified via its `LICENSE.md` and
`package.json`). It embeds a compiled build of **libheif**, which upstream
is **LGPL-3.0**, and HEIC's HEVC codec carries patent-pool licensing
considerations in principle. Judged acceptable for this project: consumed
unmodified as an npm dependency (ordinary LGPL linking/consumption, not the
modify-and-redistribute case LGPL's copyleft targets), used strictly
client-side and decode-only inside a small nonprofit's internal admin tool
by an authenticated treasurer converting a receipt photo they already
possess — not a commercial product, not redistributed as a standalone
artifact. If this judgment is ever revisited, the removal surface is a
single dynamic-import call site.

**Impact:** New `dependencies` entry in `package.json` (`heic2any`,
installed in Phase 4). New file `src/lib/heic-decode.ts` (pure failure
classifier + message lookup + one thin `import("heic2any")` wrapper,
mirroring the `image-resize.ts` pure-logic/DOM-glue split). No change to
`next.config.ts` — confirmed the existing CSP (`worker-src 'self' blob:`,
`script-src ... 'unsafe-eval' ...`) already permits the `Blob`-Worker/WASM
mechanics `heic2any` uses. Full reasoning and dependency-by-dependency
comparison in the Phase 2 section of
`docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md`.

---

## DECISION-037: Treasury User's Guide — live-value scope limited to 990 determination + current settings recap, no `ensureFilingsForFY` write from the guide

**Status:** Resolved
**Date:** 2026-07-21

**Decision:** Of the whole guide, exactly two of eleven sections read the database — `compliance-calendar-section.tsx` (current FY 990 form determination, per entity) and `settings-section.tsx` (a "current values" recap of the five settings fields). Every other section, including all 14 compliance guardrails, is pure static JSX with thresholds phrased generically ("the amount configured on the Settings page," not a dollar figure). The two live reads happen once in `page.tsx` (`getEntities()`, `getComplianceOverview(entity.id, currentFiscalYear())` per entity, `getSettings()`) and are passed down as props — section components never fetch independently. The guide calls `getComplianceOverview()` directly and deliberately does **not** call `ensureFilingsForFY()` first, unlike `compliance/page.tsx`: `determine990Result` is computed from financial totals (gross receipts/assets) inside `getOverview()`, not from the `ledger_filings` rows `ensureFilingsForFY` seeds, so skipping it doesn't affect the one value the guide displays — and a read-only content page should never trigger a write side effect.

**Rationale:** Phase 1 (Pass 4) identified the drift risk — hardcoded example numbers ("reserves below $1,000") rot the moment a treasurer edits Settings — and named two ways to resolve it: phrase generically, or interpolate live. Phase 2 (Ruling 3) confirmed JSX can support either cleanly but explicitly punted the per-value choice to Phase 3. Blanket-applying live interpolation everywhere would maximize the DB-dependent surface of a page whose entire value proposition (Phase 1, Flow 1) is that static content has no failure path; going generic everywhere would leave the 990 determination — the one number in this guide with real legal-filing consequences if a successor reads a stale example — silently wrong. Splitting the difference by value, not by section-type convention, keeps the failure surface to the two places where being wrong actually costs something.

**Impact:** `page.tsx` needs `export const dynamic = "force-dynamic"` (matches every other Ledger subpage) and an inline try/catch per live read; `compliance-calendar-section.tsx` and `settings-section.tsx` accept an optional/nullable prop and render a one-line fallback ("Unable to load the current 990 determination — see the Compliance page." / "...see the Settings page.") on failure or on an empty `getEntities()` result, rather than the full-page `LoadErrorCard` treatment (that pattern is for a whole page failing to load, not one subsection of a long static page). The other nine sections have zero DB dependency and therefore zero new failure-path surface.

---

## DECISION-036: Bank Reconciliation Sessions (inc2) — three new tables, `reconciledSessionId` provenance pointer (not a parallel status), many-to-one-ready match links, hard immutability lock on cleared rows, overlap-hard/gap-soft period validation, reopen-ordering rule, deposit-slip-vs-check-number split

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Bank Reconciliation inc2 (work-log:
`docs/work-log/2026-07-21-ledger-reconciliation-sessions.md`) locked the
following, building on this feature's Phase 2 rulings (same parent work-log,
`docs/work-log/2026-07-21-bank-reconciliation.md`):

1. **Three new tables, one new column, no second schema module:**
   `ledger_reconciliation_sessions` (bank account + statement period, opening/
   closing balances, `status` open|closed, upload metadata, close/reopen
   audit fields), `ledger_bank_lines` (parsed Chase CSV rows — signed
   `amountCents`, raw `checkOrSlipNumber`, `inStatementPeriod` flag, a
   `(sessionId, dedupeKey)` unique constraint), `ledger_reconciliation_matches`
   (bank line ↔ transaction links), and `ledgerTransactions.reconciledSessionId`
   (nullable FK, `ON DELETE SET NULL`).
2. **`reconciledSessionId` is a provenance pointer, not a parallel reconciled
   state** — modeled directly on DECISION-025's `sync_stale` precedent
   ("add a marker, don't fork state"). Session close still writes the same
   `ledgerTransactions.reconciled`/`reconciledAt` columns the legacy per-row
   toggle already writes; the new column only records *which session, if
   any,* set them. Reopen reverts only rows where `reconciledSessionId`
   points at itself. The legacy toggle route is extended to clear
   `reconciledSessionId` to null on every write (either direction) — an
   out-of-band correction always supersedes session provenance, so the two
   mechanisms can never end up pointing at stale, conflicting state.
3. **Match-link cardinality is many-to-one-ready without a future schema
   change.** `ledger_reconciliation_matches.transactionId` is `UNIQUE`
   forever (a book row clears against exactly one bank line, even after
   inc3). `bankLineId` is deliberately **not** unique at the schema layer —
   inc2's `/match` route enforces a 1:1 rule itself (reject if the bank line
   already has a match), which inc3 can simply remove at the route layer to
   enable Zeffy lump-deposit batch matching, with zero migration required.
4. **Reconciled-row immutability: a full lock, not a `syncStale`-style
   silent-degradation marker.** A transaction with `reconciledSessionId` set
   cannot be edited (any field) or deleted via the standard transaction
   routes until its closing session is reopened — structurally identical to
   the existing `approvedAt` guard. This was a genuine choice (the architect
   flagged reusing `syncStale` as a reasonable alternative); the harder lock
   was chosen because this feature's defining decision is a **hard** tie-out
   with no discrepancy-note escape hatch (User Decision, parent work-log
   Phase 1) — silently degrading a closed session's arithmetic via an
   unflagged edit would contradict that decision's spirit. `syncStale`
   keeps its original, narrower scope (a dues-payment source edit after
   reconcile).
5. **Period validation splits hard-block from soft-warning.** Overlapping
   periods on the same bank account are a hard block (409) at session
   creation, checked against sessions of *any* status, inclusive of shared
   boundary days. Non-contiguous periods (a gap between the prior session's
   close and this session's start) are a **soft, non-blocking** warning only
   — required to keep the User Decision supporting arbitrary historical
   periods (the 24-month T-13 backlog, worked non-sequentially) functional,
   while the one thing that would actually corrupt tie-out math (double-
   claimed bank-statement days) stays hard-blocked.
6. **Reopen ordering rule.** A closed session cannot be reopened if any
   *later-period* closed session exists for the same bank account — standard
   bank-rec discipline preventing an inconsistent audit trail from revisiting
   an earlier period after later periods have already finalized on top of it.
7. **Deposit-slip vs. check-number split, resolving inc1's forwarded Phase 6
   note.** Chase's own "Check or Slip #" CSV column is stored verbatim on
   every bank line regardless of sign (no schema fork). It is copied into a
   newly created transaction's `checkNumber` field only when the bank line
   is a debit (negative `amountCents`); for a credit/deposit line, the value
   is never auto-populated into `checkNumber`, since Chase's column
   conflates "check number" and "deposit slip number" — the exact category
   confusion T-21/DECISION-034 uncovered on the `payment_method` side. This
   keeps inc3's future check-number-first auto-match matching key clean.
8. **Bank lines store signed cents, diverging from `ledgerTransactions`'
   positive-only + `flow` model.** Deliberate: a bank line has no `flow`
   until matched to a book row; forcing a sign-to-flow translation at parse
   time would be a premature, lossy interpretation this staging table
   doesn't need.
9. **Parse-and-discard confirmed at the implementation level:** the CSV
   upload route never persists the uploaded file; only derived
   `ledger_bank_lines` rows are written, per the architect's Phase 2 ruling.
10. **No new `FEATURES` key.** `LEDGER_RECORD` gates create/upload/match/
    unmatch/create-from-bank-line/close; `LEDGER_MANAGE` gates reopen;
    `LEDGER_VIEW` gates reads — all enforced server-side in each route body.

**Rationale:**

Every structural choice here reuses an existing, proven shape in this
codebase (DECISION-025's marker-not-fork precedent, the `approvedAt`
immutability idiom, DECISION-035's last-state-only audit-field trio) rather
than inventing a new convention. The two genuinely new pieces of judgment —
the immutability lock's strictness and the overlap/gap split — both follow
directly from the User's explicit hard-tie-out and historical-backlog
decisions rather than from an assumed default.

**Impact:**

- `src/lib/db/schema.ts` — three new tables (`ledgerReconciliationSessions`,
  `ledgerBankLines`, `ledgerReconciliationMatches`) plus
  `ledgerTransactions.reconciledSessionId`.
- New migration `00NN_ledger_reconciliation_sessions.sql` — number is
  next-free at implementation time (`0057_ledger_receipt_waiver.sql` is
  latest as of this writing, claimed by the concurrent transaction-receipts
  work; expect `0058+`, implementer re-checks).
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts` — clears
  `reconciledSessionId` to null on every toggle write.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — new immutability
  guard mirroring `approvedAt`'s.
- New `src/lib/reconciliation.ts` (+ `reconciliation.test.ts`, 22 named
  tests) and `src/lib/reconciliation-queries.ts`.
- New API routes under `src/app/api/admin/ledger/reconciliation/sessions/`
  (create, list, detail, upload, match, unmatch, create-from-bank-line,
  close, reopen).
- New admin pages under
  `src/app/(dashboard)/admin/ledger/reconciliation/` and eight new
  components under `src/components/admin/ledger/`; new `admin-sidebar.tsx`
  nav entry.
- Implementer sequence: database-admin → api-developer → ux-developer.

---

## DECISION-035: Transaction Receipt Upload + Waiver — column rename to `receipt_storage_key`, three-column waiver (not a side table), `LEDGER_MANAGE` gating, shared `RECEIPT_KEY_REGEX`, downscale numbers, `all` pseudo-fund-slug for the guardrail link

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Transaction Receipt Upload (work-log:
`docs/work-log/2026-07-21-transaction-receipts.md`) locked the following, building on Phase 2's
architectural rulings:

1. **`ledger_transactions.receipt_url` → `receipt_storage_key`, nullable, data-free rename.**
   Verified 0/147 expense rows have a non-null value (Phase 2 read-only query), so this is a pure
   rename with no backfill branch — copies DECISION-020's opaque-key + proxy-route pattern
   already proven for member reimbursements, except nullable (an expense transaction can
   legitimately lack a receipt; a reimbursement request cannot). Migration
   `0057_ledger_receipt_waiver.sql` guards the rename for both "old column still present" and
   "already renamed" states so it's safe to re-run on every deploy.
2. **Waiver = three nullable columns on `ledger_transactions`, not a side table:**
   `receiptWaivedAt` / `receiptWaivedByUserId` / `receiptWaiverReason`. Same shape as this table's
   existing `approvedAt`/`approvedByUserId`/`rejectionReason` — a 1:1, low-cardinality
   who/when/why annotation, not a 1:many relationship that would justify a table. Un-waiving
   clears all three (reversible, not an append-only audit log — the user asked for a recorded
   reason for the *current* state, not a history of every waive/unwaive cycle).
3. **Waiving is gated `LEDGER_MANAGE`, not `LEDGER_RECORD`.** Waiving suppresses a compliance
   signal — a judgment call over whether a control requirement applies to a row — which is the
   same tier distinction that already separates `LEDGER_APPROVE` from `LEDGER_RECORD` for
   approve/reject. If waiving were gated `LEDGER_RECORD`, anyone who can enter a transaction could
   silently zero out the compliance count. No new `FEATURES` key was needed — `LEDGER_MANAGE`
   already exists for exactly this class of structural/governance authority over the books.
4. **Route shape:** `POST /api/admin/ledger/transactions/upload` (flat, no `[id]` — mirrors the
   reimbursement upload precedent, since a receipt can attach before the transaction record
   exists), `GET /api/admin/ledger/transactions/[id]/receipt` (proxy view), and
   `POST`+`DELETE /api/admin/ledger/transactions/[id]/receipt/waive` (waive / un-waive) as a
   dedicated sibling sub-route — matching this codebase's established precedent
   (`/approve`, `/reject`, `/reconcile`, `/acknowledge`) of a permission-tier step-up living in
   its own route file, never a conditional branch inside the shared PATCH handler.
5. **`RECEIPT_KEY_REGEX` hoisted** from its two duplicated definitions
   (`src/app/api/members/reimbursements/route.ts` and `.../[id]/route.ts`) into a single export
   in `src/lib/receipt-storage/index.ts`, imported at all four call sites (the two existing plus
   the two new transaction routes) rather than pasting a third copy.
6. **Downscale target: 1600px longest edge, JPEG quality 0.82; PNG converts to JPEG; PDF passes
   through untouched; HEIC stays out of scope** (the existing magic-byte/accept-list boundary
   never admitted it). 1600px keeps typical receipt text legible on zoom while shedding a modern
   phone photo's native 3000-4000px dimension; 0.82 is above the quality where JPEG block
   artifacts become visible on small receipt-font text. Pure dimension math lives in a new
   `src/lib/image-resize.ts` (unit-testable, no DOM); canvas/`toBlob()` glue is a thin client
   component, mirroring the `permissions.ts`/`permissions-server.ts` pure/environment split.
7. **Guardrail-to-list link resolves the fund-scoped-vs-entity-scoped mismatch (Phase 2 Ruling 7)
   via a new `all` pseudo-fund-slug**, not a new page. The compliance guardrail count is computed
   per-entity across all of that entity's funds, but the only filterable transaction list is
   fund-scoped. `[fundSlug]/page.tsx` gains a special case for the literal segment `all`: skip the
   single-fund lookup and fund-specific balance/budget chrome, render only the shared header and
   a transaction table built without a `fundId` filter. `GuardrailFlag` gains an optional
   `linkHref`, populated by Check 11 as
   `/admin/ledger/all?entity=<slug>&fy=<fy>&receipt=missing`, and both rendering call sites
   (`ledger-entity-detail.tsx`, `compliance/page.tsx`) render it generically.
8. **Uploading a real receipt onto a waived row clears the waiver** (not the reverse; removing a
   receipt does not waive it). An actual receipt supersedes an administrative excuse; the
   alternative (both fields set simultaneously) is an unresolvable dual state with no clear UI
   story.

**Rationale:** Every one of these mirrors an existing, proven pattern in this codebase
(DECISION-020's storage adapter, the approve/reject sibling-route shape, the
`approvedAt`/`rejectionReason` column shape, the `permissions.ts`/`permissions-server.ts` pure/
impure split) rather than inventing a new convention — the only genuinely new code is the
canvas-based image downscale, which has no repo precedent to copy (confirmed in Phase 1/2: no
`sharp`/`pica`/`browser-image-compression` dependency exists or is needed).

**Impact:** `schema.ts` gains 3 columns and one rename on `ledgerTransactions`; migration
`0057_ledger_receipt_waiver.sql`; 3 new/changed API routes plus payload changes on the existing
`POST`/`PATCH .../transactions[/[id]]`; new `src/lib/image-resize.ts`,
`receipt-file-input.tsx`, `receipt-waiver-control.tsx`; `[fundSlug]/page.tsx`,
`ledger-entity-detail.tsx`, and `compliance/page.tsx` render the new receipt state and the
guardrail's actionable link. No new `FEATURES` keys, no new tables. Implementer sequence:
database-admin → api-developer → ux-developer.

---

## DECISION-034: Ledger Check Numbers (T-18, inc1) — text column, CSV-replay backfill (not memo-parsing, not re-running the destructive importer), uncashed-checks detection unchanged

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Bank Reconciliation inc1 (work-log:
`docs/work-log/2026-07-21-ledger-check-number.md`) locked the backfill
mechanism after the task's stated premise — "check numbers live in
free-text memos," per `docs/treasurer-todo.md` T-18 and the parent
work-log's Intent — turned out to be empirically false on inspection:

1. **`check_number` is `text`, not `integer`**, with a composite, non-unique
   index on `(bank_account_id, check_number)`. Matches this codebase's
   convention for numeric-looking identifier fields (`last4`, `slug`) that
   are only ever exact-matched, never subject to arithmetic or range
   queries — and avoids baking in a leading-zero/format assumption the real
   data doesn't need but a future account's data might.
2. **Backfill source is the original Quicken register CSVs, not memo/party
   text.** Sampling the local DB's 109 `paymentMethod='check'` rows showed
   memo/party text almost never contains a check number — the one row that
   does ("Replacement for check #8045") refers to a *different* check's
   number than its own row. Tracing further: `scripts/import-quicken-ledger.ts`
   already parses a `checkNum` field from the register's "Check #" column at
   import time; it's discarded before insert, used only for cause-derivation
   and console logs. The real numbers are recoverable, near-unambiguously,
   from the source CSVs (still on disk, paths already hardcoded in that
   script).
3. **Backfill mechanism is a new, additive, `UPDATE`-only script
   (`scripts/backfill-check-numbers.ts`), not a re-run of
   `import-quicken-ledger.ts`.** That importer's idempotency model is
   destructive-and-total: it deletes every `[quicken-import]`-marked row and
   reinserts all of them fresh with new UUIDs, computing `reconciled`/
   `reconciledAt` from the CSV's own "Clr" column rather than live DB state.
   Re-running it today would silently discard any reconciliation/edit state
   the treasurer has layered on via the admin UI since the 2026-07-20 seed,
   and cascade-delete any `ledgerAcknowledgments` referencing a
   soon-to-be-replaced transaction ID. The new script instead matches each
   CSV register row to its corresponding existing DB row by
   (`entityId`, `txnDate`, `amountCents`, `paymentMethod='check'`, `flow`,
   `[quicken-import]` marker) and does a targeted `UPDATE ... SET
   check_number = $1 WHERE id = $2` — never touching any other column, never
   changing the row's `id`. Zero or multiple matches are logged to a review
   list rather than guessed at, satisfying Phase 1's low-confidence-review
   requirement at the point where this dataset's actual ambiguity lives
   (CSV-to-row matching), not at a memo-regex step with almost no signal to
   parse. `import-quicken-ledger.ts` itself gets an *additive* enhancement
   (capture `checkNumber` in its row-builder) purely so that production's
   still-pending first seed (production is unseeded per project memory)
   gets the column for free — that enhancement is not re-run against the
   already-seeded local DB.
4. **A memo-parsing pure function (`parseCheckNumberFromMemo` in the new
   `src/lib/check-number.ts`) is kept, but demoted to a low-confidence
   enrichment hint** surfaced only on rows the CSV-match step can't resolve
   — never the primary mechanism. Its test suite is built directly from the
   real ambiguous example found in the data (the "replacement for check
   #8045" row, whose own actual number is 8049).
5. **Uncashed-checks detection is unchanged**, correcting a mischaracterization
   in the parent work-log's framing. `getDashboard()`'s uncashed-checks query
   already detects via `paymentMethod='check'` + `flow='expense'` +
   `reconciled=false` (DECISION-031/032) — memo is only ever displayed, never
   used for detection. `checkNumber` is added as a new displayed column only;
   detection does not switch to requiring a non-null `checkNumber`, since that
   would silently drop legitimate uncashed checks lacking a backfilled/typed
   number.
6. **Surfaced, not fixed: 3 rows mistagged `paymentMethod='check'`** (Walmart,
   OTC Brands, FSP Product Decorator — all register "Check #"="Card") are
   actually debit-card purchases per the register's own data. The backfill
   script reports this plainly and offers a separate, explicit
   `--fix-payment-method` opt-in flag — never bundled into the default
   `--apply` — since it's a real but independently-scoped data-quality fix
   discovered as a byproduct, not this increment's stated column.

**Rationale:**

Every choice here follows from checking the stated premise against real data
before designing around it, rather than building the memo-parser the task
framing assumed was needed. A regex parser built to spec against a premise
that doesn't hold would have produced a "backfill" that silently populated
almost nothing, while a destructive-reinsert "backfill" (the more literal
reading of "re-run the idempotent importer") would have quietly destroyed
weeks of admin-UI reconciliation state the first time someone ran it. The
CSV-replay-plus-safe-UPDATE design gets near-total, low-risk coverage for
the one dataset that actually needs backfilling (local dev; production isn't
seeded yet) while leaving every other column and every row ID untouched.

**Impact:**

- `src/lib/db/schema.ts` — `ledgerTransactions.checkNumber` (text, nullable) +
  composite index.
- `drizzle/migrations/00NN_ledger_check_number.sql` (new; NN = next free slot
  at implementation time, after `0055`).
- `src/lib/check-number.ts` (new) — `parseCheckNumberFromMemo()`,
  `classifyRegisterCheckColumn()`; `src/lib/check-number.test.ts` (new) — ten
  named unit tests.
- `scripts/backfill-check-numbers.ts` (new) — additive, dry-run-default,
  `--apply` to write, `--fix-payment-method` opt-in for the debit-card
  correction.
- `scripts/import-quicken-ledger.ts` — additive `checkNumber` capture in the
  row-builder (for production's still-pending first seed); not re-run
  against local dev as part of this increment.
- `src/components/admin/ledger/transaction-form.tsx`,
  `src/components/admin/ledger/uncashed-checks-panel.tsx`,
  `src/lib/ledger-queries.ts` (`UncashedCheckRow` widen),
  `src/app/api/admin/ledger/transactions/route.ts` and `.../[id]/route.ts`.
- Full design: `docs/work-log/2026-07-21-ledger-check-number.md`, Phase 3 —
  Technical Design.

---

## DECISION-033: Failed Login Visibility — table/enum shape, permission-naming convention, opportunistic-prune pattern, IP/UA deferred

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Failed Login Visibility (work-log:
`docs/work-log/2026-07-21-failed-login-visibility.md`) locked five
implementation-level choices Phase 2 explicitly deferred:

1. **New table `failed_login_attempts`** — `id` (uuid), `attempted_email`
   (`varchar(255)`, length-capped at the recorder call site, not relying on
   the DB constraint to reject-and-throw), `provider` (text: `"credentials"`
   | `"google"`), `reason` (text, six values —
   `missing_credentials`/`unknown_email`/`no_password_set`/`deactivated`/
   `bad_password`/`oauth_deactivated`), nullable `user_id` FK
   `ON DELETE SET NULL` (mirrors `event_occurrence_overrides.cancelled_by_user_id`,
   DECISION-001), `created_at` as `timestamptz` (not naive `timestamp` — this
   project has a documented naive-timestamp-as-UTC bug on unrelated
   `eventRsvps`/occurrence columns). Two indexes: `created_at` (reverse-chron
   list) and `attempted_email` (search + grouped `GROUP BY`). Split across
   two migrations, `0054_failed_login_attempts.sql` (table) and
   `0055_admin_security_permission.sql` (permission), following this repo's
   established convention (`0044_ledger_books.sql` → `0045_ledger_permissions.sql`,
   `0040_dues_tracking.sql` → `0041_dues_permissions.sql`) rather than one
   combined file.
2. **Permission key: `FEATURES.ADMIN_SECURITY_VIEW = "admin.security_view"`.**
   Architect Ruling 5 left the naming convention open (bare-noun `admin.*`
   style vs. action-suffixed `*.view` style, both precedented in the same
   catalog). Chose the action-suffixed style to leave room for a future
   `admin.security_manage` (e.g., a manual "clear old entries" action) without
   a rename, matching the `DUES_VIEW`/`DUES_MANAGE` and
   `LEDGER_VIEW`/`LEDGER_MANAGE` precedent. Bound to `admin` role only (locked
   user decision) — not `treasurer` or `board_member`.
3. **Opportunistic prune, piggybacked on insert, unconditional deletion** —
   no cron/worker infra exists in this project. Cutoff computed by a pure,
   independently-unit-tested function `pruneCutoff(now: Date = new Date())`
   returning `now - 90 days` as a plain JS `Date`, rather than a Postgres
   `now() - interval '90 days'` SQL expression — this makes prune-window
   correctness testable without a DB connection and sidesteps any
   Postgres-interval-syntax edge case.
4. **IP address / user agent capture ruled OUT of v1.** `next/headers`'
   `headers()` would very likely work inside NextAuth's `authorize()`/`signIn`
   callbacks (they execute inside the App Router route handler NextAuth
   registers), but "very likely" isn't good enough to bake an unverified API
   call into a fire-and-forget block that must never throw, for a feature
   Phase 1 explicitly scoped as a nice-to-have. Deferred as a candidate,
   additive (`ADD COLUMN IF NOT EXISTS`), non-blocking fast-follow.
5. **`Credentials.authorize()`'s existing `if (!user || !user.password) return null;` must be split into two branches** (`unknown_email` vs.
   `no_password_set`) to preserve the six-way reason granularity the analyst
   required — this is a real logic change, not just an additive recorder
   call, and was called out explicitly so the implementer doesn't under-scope
   it as "add six calls."

**Rationale:**

Each choice follows existing repo precedent over inventing a new one: the
migration split matches every prior new-table-plus-permission feature; the
`timestamptz`/nullable-FK/index choices directly reuse patterns this codebase
already debugged into correctness (DECISION-001, the naive-timestamp bug);
the `pruneCutoff()` pure-function design keeps a security-relevant retention
rule testable and DB-independent, the same discipline DECISION-031/032
applied to `getDashboard()`'s query-layer seams. Deferring IP/UA capture
trades a nice-to-have for a smaller, better-verified v1 surface, consistent
with the analyst's own framing of it as optional.

**Impact:**

- `src/lib/db/schema.ts` — new `failedLoginAttempts` table + types; `varchar` added to the top-of-file import list.
- `src/lib/permissions.ts` — `FEATURES.ADMIN_SECURITY_VIEW` + `FEATURE_DESCRIPTIONS` entry.
- `src/lib/auth/failed-login.ts` (new) — recorder, `normalizeAttemptedEmail`, `pruneCutoff`, shared enums/labels; `src/lib/auth/failed-login.test.ts` (new) — five named unit tests.
- `src/lib/auth/index.ts` — six `recordFailedLogin()` call sites, including the required branch split.
- `src/app/(dashboard)/admin/security/page.tsx` (new), `src/components/admin/admin-sidebar.tsx` (new nav item).
- `drizzle/migrations/0054_failed_login_attempts.sql`, `drizzle/migrations/0055_admin_security_permission.sql` (new).
- Full design: `docs/work-log/2026-07-21-failed-login-visibility.md`, Phase 3 — Technical Design.

---

## DECISION-032: Ledger Dashboard — implementation-level calls from Phase 3 design (error boundary, mobile table pattern, EntitySwitcher non-reuse, uncashed-checks flow scoping, fund-name guardrail widen)

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 3 technical design for the Ledger Dashboard (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`) resolved five implementation-level questions Phase 2 left open:

1. **Error boundary: inline `try/catch` in `page.tsx`, not `error.tsx`.** This codebase has zero existing `error.tsx` files; introducing one would be a first-of-its-kind Client Component boundary for a single page's static failure card, cutting against the Server-Component-by-default invariant for no interactivity gained (retry is a plain `<Link>` re-navigation). `try/catch` wraps each of the page's three DB-fetching phases individually, rendering a shared `LoadErrorCard()`. Correctness trap documented for the implementer: `redirect()` throws internally and must never sit inside one of these `try` blocks.
2. **Uncashed-checks list reuses the Approvals page's `overflow-x-auto` table pattern, not a stacked card list.** Confirmed by reading `src/app/(dashboard)/admin/ledger/approvals/page.tsx` (L111–113) — this is the established convention for tabular admin-ledger lists, already solving the same mobile-overflow problem Phase 1 Gap #5 raised. Matching it beats inventing a second, inconsistent pattern.
3. **`EntitySwitcher` is not reused for the dashboard's entity-card row.** It's a Client Component implementing a single-select tab toggle (`router.push`, one active entity); the dashboard needs always-show-both stat cards with no active/selected concept. A new Server Component (`dashboard-entity-card.tsx`) is cleaner than gutting `EntitySwitcher`'s interaction model and forcing an unneeded client boundary onto the dashboard. `EntitySwitcher` is unchanged and stays in use on the per-entity detail view.
4. **Uncashed-checks query scoped to `flow='expense'`, not just `paymentMethod='check'`.** "Uncashed checks" is a check-writer's-eye-view concept (checks the club wrote that a payee hasn't cashed); a `flow='income'` check-tagged row (an incoming check payment) is a different concept and would carry the wrong meaning if it ever appeared unreconciled in this list. The dev-DB spot-check found the one existing `check`/`income` row is already reconciled, so this doesn't change today's output — it's forward-looking correctness.
5. **Aged-public-fund guardrail detail text gains fund names via an additive, optional field**, not a breaking change to `AgedPublicFundFact`/`GuardrailsInput`. `fundName` is optional on `AgedPublicFundFact` (the 11 existing `countAgedPublicFunds` test literals don't set it and keep compiling); `agedPublicFundNames?: string[]` is a new optional `GuardrailsInput` field; a private `isAgedPublicFund()` predicate is shared between `countAgedPublicFunds()` and the new `agedPublicFundNames()` so the count and the name list can never disagree — same reuse discipline `fundBalanceCents()` established under DECISION-028/029.

**Rationale:**

Each of these follows the same underlying principle: match this codebase's own established precedent (Approvals table, `fundBalanceCents()` reuse, additive/optional field conventions already used throughout `GuardrailsInput`) rather than introduce a new pattern, even where introducing one wouldn't be wrong in isolation. The error-boundary and `EntitySwitcher` calls both protect the Server-Component-by-default invariant from a plausible but unnecessary client-boundary creep.

**Impact:**

- `src/lib/ledger.ts` — `AgedPublicFundFact.fundName?: string`, private `isAgedPublicFund()`, new `agedPublicFundNames()`, `GuardrailsInput.agedPublicFundNames?: string[]`, `guardrails()` detail-string change, new `daysSinceTxnDate()`.
- `src/lib/ledger-queries.ts` — `EntityOverview` widened (`syncStaleTxns`, `unreconciledPriorMonth`); new `getDashboard()` and its exported types (`DashboardData`, `DashboardEntitySummary`, `EntityTaggedGuardrailFlag`, `UncashedCheckRow`).
- `src/app/(dashboard)/admin/ledger/page.tsx` and four new files under `src/components/admin/ledger/` — see full component plan in the work-log.
- No schema change. No new `FEATURES` key.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 3 — Technical Design.

---

## DECISION-031: Ledger Dashboard — same route (searchParams-keyed), new `getDashboard()` query function rather than widening `getOverview()`

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 2 architectural review for the Ledger Dashboard feature (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`). Two rulings:

**Ruling A — Route structure.** `/admin/ledger` stays a single `page.tsx`, keyed by `searchParams`: no `entity` param renders the new two-entity dashboard; `?entity=<slug>&fy=<year>` renders the existing per-entity detail view, unchanged. No new nested route (`/admin/ledger/[entitySlug]`). Every existing internal link in this surface (fund cards, reimbursements, reports, fund-report quick links) already passes `entity=`/`fy=` explicitly and needs zero changes. The admin sidebar's "Ledger" item already points at bare `/admin/ledger` — under this ruling it lands on the dashboard, exactly the desired top-of-nav UX, for free. `[fundSlug]` stays a genuinely nested route because a fund is a distinct sub-resource; dashboard-vs-detail is a view-mode toggle on the same resource, correctly modeled as a query param per Next.js App Router convention.

**Ruling B — Query-layer shape.** A new `getDashboard()` function in `src/lib/ledger-queries.ts`, not an extension of `EntityOverview`/`getOverview()`. `getOverview()` is single-entity and FY-scoped by contract; the dashboard needs a different shape (both entities' summaries, a cross-entity uncashed-checks list, cross-entity audit-item counts) that would break `EntityOverview`'s single-entity contract for every existing consumer if bolted on. `getDashboard()` composes two `getOverview()` calls (current FY per entity, in parallel via `Promise.all`, matching the page's existing batch-fetch style) plus one new cross-entity query for unreconciled check-method transactions. Separately, `EntityOverview` gets a minimal *additive* widen — `syncStaleTxns` and `unreconciledPriorMonth`, both already computed inside `getOverview()` but not returned (Phase 1 Gap #4) — since exposing already-computed per-entity fields is compatible with the existing contract, unlike making the function itself cross-entity.

**Rationale:**

`getOverview()` is already ~300 lines and has been the subject of two correctness bug fixes in the preceding 24 hours (DECISION-028, DECISION-029), both rooted in logic — guardrail inputs, cross-FY rollforward — accreting inline inside one DB-bound function with no unit-test seam. Adding a third responsibility (cross-entity dashboard aggregation) would repeat the exact anti-pattern DECISION-028's rationale named as the root cause. A dedicated `getDashboard()` keeps `getOverview()`'s single-entity contract stable, gives the new cross-entity aggregation its own seam, and follows the batch-fetch discipline established in DECISION-027 Ruling A (one new query, not N+1).

**Impact:**

- `src/lib/ledger-queries.ts` — new `getDashboard()` function; `EntityOverview` type widened with `syncStaleTxns: number` and `unreconciledPriorMonth: number`.
- `src/app/(dashboard)/admin/ledger/page.tsx` — branches on presence/validity of the `entity` searchParam; no new route file.
- No schema change. Structured `checkNumber` column (Phase 1 Gap #1) stays explicitly out of scope for this feature — a `treasurer-todo.md` follow-up item, not a migration riding along with this work.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 2 — Architectural Review.

---

## DECISION-030: Philanthropy/impact reporting counts TRUE GIFTS only — fundraising-overhead and operational spend excluded via a new per-category `counts_as_giving` flag, with conservative null-inclusion

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

`/members/impact` (all-time/current-FY giving totals, giving by cause, giving by fiscal year, recent named gifts) previously counted every posted, non-transfer expense row on an `activity`/`charitable`/`scholarship` fund as philanthropic giving. That predicate over-counted: fundraising event costs, general operations, and insurance & bonding are real expenses against public/charitable funds but are not gifts given to a cause — they are the overhead of running the club/Foundation. A new `ledger_categories.counts_as_giving` boolean (`NOT NULL DEFAULT true`) marks categories whose spend is operational/fundraising overhead; `false` excludes a category's transactions from philanthropy reporting even though the transaction otherwise satisfies the existing giving-eligible fund-kind rule. Three categories were flagged `false` on migration: `Fundraising event costs`, `Operations`, `Insurance & bonding` (all entities, expense flow).

The giving predicate — duplicated by design at two synced sites, `isGiving()` (`src/lib/ledger.ts`) and the SQL `WHERE` clause inside `getPhilanthropy()` (`src/lib/ledger-queries.ts`) — was extended at both sites with the same rule: `categoryCountsAsGiving !== false` (helper) / `counts_as_giving IS NOT FALSE`-equivalent via `LEFT JOIN` + `OR(isNull, = true)` (SQL). A **null or missing flag stays INCLUDED** — a transaction with no `categoryId`, or whose category has never had the flag set explicitly to `false`, is not silently dropped from the report; it keeps appearing under "Other community support." Only an explicit `false` excludes a row.

**Rationale:** The conservative null-inclusion choice was deliberate, not an oversight. `categoryId` is nullable on `ledger_transactions` (`onDelete: 'set null'`), so uncategorized or since-recategorized public-fund expenses exist and will continue to exist. Defaulting an unset/unknown flag to *exclude* would silently shrink the giving total every time a category went uncategorized or a category row was deleted — the opposite failure mode from the one this decision fixes, and harder to notice because it fails quiet rather than loud. Requiring an explicit `false` means every exclusion is a deliberate, auditable act (a migration UPDATE or a future admin toggle), never an accident of missing data.

Only surfaces that need the "true gift" meaning were touched. `determine990()` and `get990Prep()` were audited and left untouched — the 990 needs actual expense totals (operations, insurance, and fundraising costs all belong on the return), which is the opposite of what this refinement excludes; narrowing the predicate there would corrupt compliance math. `getDonor()`'s `givingHistory` (money donors give *to* the club, `flow='income'`) is a different, unrelated concept from `isGiving()` (money the club/Foundation gives *out*, `flow='expense'`) and was not touched.

**Impact:**
- `src/lib/db/schema.ts` — `ledgerCategories.countsAsGiving: boolean("counts_as_giving").notNull().default(true)`.
- `drizzle/migrations/0053_ledger_category_counts_as_giving.sql` — idempotent `ADD COLUMN IF NOT EXISTS` + guarded `UPDATE` flagging the three named categories false across all entities.
- `src/lib/ledger.ts` — `isGiving(row, fundKind, categoryCountsAsGiving?)` gains a 3rd optional parameter; existing call shape (2-arg) unaffected.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()`'s two queries (aggregate fold + recent-named-gifts) both gain a `LEFT JOIN` to `ledger_categories` and the `counts_as_giving` filter.
- `src/lib/ledger-impact.test.ts` — 5 new `isGiving()` cases covering explicit `false`/`true`/`null`/omitted, and `false` stacked with an already-disqualifying fund kind.
- Dev-DB giving total: $86,682.64 → $61,999.54 (−$24,683.10 across 43 excluded transactions).
- Full work-log: `docs/work-log/2026-07-20-impact-true-gifts.md`.

---

## DECISION-029: Ledger fund opening/ending balances rolled forward past their static seed for any FY after the fund's first

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Bug fix (display-side counterpart to DECISION-028). `getOverview()`, `getFundReport()`, and `getEntityReport()` in `src/lib/ledger-queries.ts` all computed a fund's `openingCents` for the selected FY as the raw `fund.openingBalanceCents` seed — a static value anchored once at the fund's inception (e.g. 6/30/2024) and never itself mutated — and `endingCents` as `openingCents + <selected-FY posted income> − <selected-FY posted expense>`. For any FY after the fund's first, this silently dropped every prior fiscal year's net activity from both figures. Seeded with 276 real transactions spanning FY2024-25 and FY2025-26 (`scripts/import-quicken-ledger.ts`, 2026-07-20), the bug became visible for the first time: `/admin/ledger` showed the club's Administrative Fund at $19,090.10 (the raw seed) instead of the true $16,134.12, Activity at $0.00 instead of $84.52, and the Foundation's Charitable Fund at $28,569.30 instead of $4,836.57.

**Fix:** each affected function now runs a companion "pre-FY rollforward" query — `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE status='posted' AND txn_date < <FY start> GROUP BY fund_id, flow`, unbounded below, posted-only — and feeds the result into a new pure function, `rolledForwardOpeningCents(seedCents, preFyTxns)` in `src/lib/ledger.ts`. That function filters defensively to `status === 'posted'` (belt-and-suspenders with the SQL WHERE clause, same defense-in-depth posture as the DECISION-026 Ruling 3 unique index) and delegates the actual summation to the existing canonical `fundBalanceCents()` — no second, hand-rolled balance formula, matching the reuse discipline DECISION-028 established. `endingCents` is then `rolledForwardOpening + <selected-FY posted income> − <selected-FY posted expense>`, unchanged in shape from before.

**Call sites fixed:** `getOverview()` (one companion query, batched across all of the entity's funds), `getFundReport()` (one companion query, single fund), `getEntityReport()` (one companion query, batched across all of the entity's funds — mirrors `getOverview()`'s shape exactly). **Call sites already correct / unaffected:** `getComplianceOverview()`, `get990Prep()`, and the `entityBalance` sums inside `getEntityReport()`/`getOverview()` all derive their entity-level balance by summing `fundSummaries[].endingCents` or `fundReports[].endingCents` — once the three primary functions were fixed, these derived sums became correct automatically with no code change. The `agedPublicFunds` guardrail path (Query A2 + `countAgedPublicFunds()`, DECISION-028) was already cross-FY-correct by construction and was not touched.

**Behavioral note:** `entityBalanceCents` fed into `guardrails()` (Check 4 — reserves below threshold — and Check 6 — negative fund balance, per-fund) now reflects the TRUE rolled-forward balance rather than a FY-scoped delta-only figure. This is a correctness fix, not a meaning change: both checks' intent was always "is the club's real money low or negative right now," and the FY-scoped figure was silently wrong for any FY after a fund's first.

**Rationale:** Reusing `fundBalanceCents()` rather than hand-rolling a third balance formula keeps every "balance" in the codebase provably identical in arithmetic (same discipline DECISION-028 established for the cross-FY aged-funds figure). Filtering defensively inside `rolledForwardOpeningCents()` even though the SQL query already filters to `status='posted'` follows the project's established defense-in-depth pattern (DECISION-026 Ruling 3) and — unlike the SQL-only alternative — gives this money-figure computation a real Vitest seam, since `ledger-queries.ts` functions have no DB-mocking test infrastructure in this codebase (same gap DECISION-028's rationale names).

**Impact:**
- `src/lib/ledger.ts` — new exported `rolledForwardOpeningCents(seedCents, preFyTxns)`.
- `src/lib/ledger-queries.ts` — new pre-FY rollforward query + `rolledForwardOpeningCents()` call in `getOverview()`, `getFundReport()`, `getEntityReport()`. `FundReport`/`FundSummary` type doc comments updated to describe the rolled-forward `openingCents` contract.
- `src/lib/ledger.test.ts` — new `describe("rolledForwardOpeningCents", ...)` block: first-FY regression, later-FY rollforward with the real repro numbers, pre-FY pending/rejected exclusion, zero-seed fund, multi-row netting.
- No schema change, no new routes.
- Full work-log: `docs/work-log/2026-07-20-ledger-balance-rollforward.md`.

---

## DECISION-028: Lions Fund-Compliance Guardrails — aged-public-fund gate corrected to a true cross-FY balance; gating logic extracted into a testable pure function

**Status:** Resolved (corrects part of DECISION-027)
**Date:** 2026-07-20

**Decision:**

QA's Phase 5 verification (2026-06-27 work-log, Bug 2) found that the aged-public-fund WARN silently fails to fire whenever a public fund's aged, undisbursed income falls entirely in a fiscal year other than the one currently selected in `getOverview()`. Root cause: the balance-positive gate reused `fundSummaries[].endingCents`, which DECISION-027's Ruling B explicitly (and incorrectly) specified as the balance source: *"The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`."* That field is bound to the FY window passed into `getOverview()` — it is not the fund's true balance. This decision corrects that one sentence of DECISION-027. Ruling A (category batch-fetch) and the rest of Ruling B (dedicated query over a denormalized column) are unaffected and stand.

**Corrected design:**

1. **New companion aggregate query in `getOverview()`** (`src/lib/ledger-queries.ts`), alongside the existing (unchanged, already-correct) Query A: a `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE fund_id IN (<publicFundIds>) AND status='posted' AND flow IN ('income','expense') GROUP BY fund_id, flow` — no FY bound, bounded to public fund IDs only (same bounded-batch discipline as DECISION-027).
2. **Reuse the existing canonical balance function**, `fundBalanceCents(openingCents, postedTxns)` (already defined in `src/lib/ledger.ts`, already unit-tested, already imported into `ledger-queries.ts` but previously unused there) — called once per public fund with two synthetic `FlowRow` entries built from the new query's per-flow sums. This guarantees the cross-FY figure uses **exactly** the same arithmetic as every other balance in the system; no second, hand-rolled definition of "balance" is introduced.
3. **New exported pure function `countAgedPublicFunds()`** in `src/lib/ledger.ts`, alongside `guardrails()`. Takes an array of per-fund cross-FY facts (`fundKind`, `crossFyBalanceCents`, `oldestPostedIncomeDate`), a threshold, and an injectable `now`, and returns the count. `getOverview()` builds this fact array from the fund rows + the new query + the existing (unchanged) Query A, and calls this function instead of inline-filtering `fundSummaries`.
4. **`GuardrailsInput` / `guardrails()` signature is unchanged.** The bug and its fix are entirely upstream of `guardrails()`, which still receives a flat `agedPublicFunds: number` count. No change to the pure gating function or its existing 5 unit tests.

**Rationale:**

The extraction into `countAgedPublicFunds()` is the direct fix for the coverage gap QA flagged: the original aggregation lived inline inside `getOverview()`, a DB-bound function with no unit-test seam in this codebase (confirmed: no test file exercises `getOverview()` today), so the FY-scoping defect had no layer capable of catching it before a live click-through. A pure function taking plain data and returning a count can be — and now is — unit tested directly with fixture data that reproduces QA's exact scenario (a fund whose cross-FY balance is positive but whose FY-scoped view would read $0), closing the gap at the layer where it actually belongs rather than asking QA to invent DB-mocking infrastructure under loop-back pressure.

**Impact:**

- `src/lib/ledger-queries.ts` — new companion query in `getOverview()`; `agedPublicFundsRaw` computation rewritten to call `countAgedPublicFunds()`.
- `src/lib/ledger.ts` — new exported `countAgedPublicFunds()` function and its input type, placed near `guardrails()`.
- `src/lib/ledger.test.ts` — new `describe("countAgedPublicFunds", ...)` block, including a named regression test for the exact FY-scoping failure QA reproduced. No change to the existing `guardrails()` Enhancement-1 tests.
- No schema change. No change to `GuardrailsInput`'s shape or `guardrails()`'s existing tests.
- Full design: `docs/work-log/2026-06-27-lions-fund-compliance.md`, "Phase 3 — Revised Design (loop-back from Phase 5) — 2026-07-20."

---

## DECISION-027: Lions Fund-Compliance Guardrails — cross-FY aging query approach and Enhancement 2 category-fundKind resolution strategy

**Status:** Resolved
**Date:** 2026-06-27

**Decision:**
Two architectural rulings for the Lions Fund-Compliance Guardrails feature (work-log: `docs/work-log/2026-06-27-lions-fund-compliance.md`):

**Ruling A — Enhancement 2 (direct-to-admin public income): resolve category `fundKind` via a single batch fetch before the aggregation pass, not a JOIN on `allTxns`.**

`getOverview()` currently fetches all FY transactions in one query and then aggregates in TypeScript. To compute `adminPublicIncomeCount` (income rows in an administrative fund where the category's `fundKind != 'administrative'`), the aggregation loop needs `fundKind` for each transaction's `categoryId`. The cleanest approach consistent with the file's existing N+1-avoidance pattern:

1. After fetching `allTxns`, collect the distinct `categoryId` values that appear on income rows in administrative funds.
2. Fetch those category rows in a single `inArray` query (at most one extra round-trip; category sets are small — typically < 20 rows per entity).
3. Build a `Map<categoryId, fundKind>` and use it in the existing TypeScript aggregation pass.

This is preferred over joining categories into the `allTxns` query because: (a) `allTxns` is already used for multiple aggregation purposes and adding a LEFT JOIN would widen every row for a check that only applies to a small subset; (b) the precedent in `getFundReport()` and `getEntityReport()` is exactly this pattern — fetch categories separately, merge in TypeScript; (c) the category set for an entity is bounded and small enough that a batch fetch is cheap and idiomatic. The `get990Prep()` SQL approach (inline LEFT JOIN) is a counter-precedent but is appropriate there because the entire function is a single SQL GROUP BY — not a TypeScript aggregation pass.

**Ruling B — Enhancement 1 (aging guardrail): use a dedicated cross-FY aggregate query, not a denormalized column.**

The aging check needs the oldest posted income date for each public fund (kind ∈ activity/charitable/scholarship) across all fiscal years, where the fund's current balance is positive. The two options were:

- Option 1: A small dedicated SQL query added to `getOverview()` — one extra DB round-trip, computes `MIN(txn_date)` per fund over all posted income rows with no FY bound, filtered to public funds.
- Option 2: A denormalized `ledger_funds.oldest_posted_income_date` column maintained on every insert/update/delete of an income transaction.

**Ruling: use Option 1 (dedicated query).** Rationale: a denormalized column (Option 2) introduces a write-time maintenance obligation that spans every income transaction mutation path (record, approve, reject, hard-delete) — four distinct touch points, each requiring the column to be recalculated. A bug in any one of those paths silently corrupts the guardrail. Option 1 is a single read-time query that is always correct by definition. The performance cost is one additional DB query per `getOverview()` call, which is acceptable — `getOverview()` already runs multiple round-trips (entity, funds, settings, transactions) and this query returns O(N-funds) aggregate rows, not O(N-transactions) data.

**Correctness of the "unspent" proxy:** The metric is "oldest posted income date on a fund where the current balance is positive." This is a conservative proxy — a fund with $0 net balance but old income and old offsetting expenses will NOT fire (correct: the money was spent). A fund with any positive balance AND old income will fire. This matches the analyst's G-3 specification. The query is: `SELECT fund_id, MIN(txn_date) as oldest_income_date FROM ledger_transactions WHERE flow='income' AND status='posted' AND fund_id IN (<public-fund-ids>) GROUP BY fund_id`. The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`.

**Rationale:**
The N+1-free discipline in `ledger-queries.ts` is worth preserving — but N+1 means unbounded per-row round-trips, not "more than two queries." A bounded batch fetch (Ruling A) and a single aggregate query (Ruling B) both stay within the spirit of the file's documented strategy. Denormalized columns that mirror computed values across multiple write paths are a consistent source of drift bugs and are the wrong tool when a read-time query is fast and correct.

**Impact:**
- `getOverview()` in `src/lib/ledger-queries.ts` gains one new batch-fetch for category `fundKind` (Ruling A) and one new cross-FY aggregate query for oldest income date (Ruling B).
- `GuardrailsInput` in `src/lib/ledger.ts` gains two new fields: `agedPublicFunds: number` and `adminPublicIncomeCount: number`.
- `ledger_settings` in `src/lib/db/schema.ts` gains `holdingPeriodWarnDays: integer` (default 365). A matching idempotent migration is required.
- No new npm dependencies, routes, or directories. All changes are confined to `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts`, and `drizzle/migrations/`.

---

## DECISION-026: `deriveAckType()` — quid-pro-quo type takes precedence over written-ack when both thresholds are met; `amountCents` on `ledgerAcknowledgments` is immutable after creation; DB-level unique index on `donation_txn_id` is defense-in-depth

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Three implementation-level rulings for the Ledger inc6a acknowledgment feature:

1. **`deriveAckType` precedence when both thresholds are met.** When a gift is both ≥ $250 (written-ack threshold) AND carries a quid-pro-quo FMV ≥ $75 (disclosure threshold), the derived type is `'quid_pro_quo_75'`, not `'written_ack_250'`. Rationale: the quid-pro-quo disclosure obligation is stricter — it requires itemizing the FMV of goods/services received. A `written_ack_250` letter that omits the quid-pro-quo FMV would be legally insufficient. Using `'quid_pro_quo_75'` when both apply ensures the treasurer records the FMV. Manual override (`typeOverride`) allows the treasurer to change the type when the auto-derived result is wrong.

2. **`amountCents` on `ledgerAcknowledgments` is immutable after creation.** The `PATCH /api/admin/ledger/transactions/[id]/acknowledge` (mark-sent) route does not accept `amountCents` in the request body. The column is copied from the linked transaction at ack-creation time and never updated. If the underlying transaction's amount is corrected after the ack is created, the ack retains the amount that was acknowledged — which is the legally correct amount to state in the letter. A note is surfaced in the UI if the ack amount diverges from the current transaction amount (a simple display-layer comparison; no structural enforcement needed).

3. **Unique index on `ledgerAcknowledgments(donationTxnId)` as defense-in-depth.** The API already enforces one-ack-per-transaction at the application layer, but a DB-level unique index (`CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`) provides a second line of defense against race conditions (two simultaneous POST requests for the same transaction). The index is included in `0051_ledger_donors.sql`. The application-layer check returns a user-readable 409 before the DB constraint would trigger, so the raw `DatabaseError` from the constraint is a backstop, not the primary error path.

**Rationale:**
Ruling 1 flows from IRS Pub 1771: a quid-pro-quo contribution over $75 requires disclosure of the FMV of goods/services. A written acknowledgment alone is insufficient if goods/services were provided. Erring on the side of the stricter type is the only correct default.

Ruling 2 is the standard approach for legal acknowledgment records: the letter states what was received by the organization at the time the relationship was recorded, not a later-revised figure. Allowing the ack amount to drift with transaction edits would make the record misleading.

Ruling 3 is consistent with the existing unique-constraint pattern on `ledger_transactions(dues_payment_id)` (DECISION-025). Small implementation cost, prevents a hard-to-debug data integrity issue.

**Impact:**
- `src/lib/ledger.ts` — `deriveAckType(amountCents, quidProQuoValueCents)` returns `'quid_pro_quo_75'` when `quidProQuoValueCents >= 7500`, regardless of whether `amountCents >= 25000`.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (PATCH) — no `amountCents` field accepted.
- `drizzle/migrations/0051_ledger_donors.sql` — includes `CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`.
- Vitest tests for `deriveAckType` must include the case: $300 gift + $75 quid-pro-quo → `'quid_pro_quo_75'`.

---

## DECISION-025: Dues↔Ledger coupling — same-transaction-atomic via `src/lib/dues-ledger-sync.ts`; `sync_stale` marker for reconciled-conflict

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Six structural rulings for the Ledger inc 6a dues↔ledger auto-post feature:

1. **Helper module:** `src/lib/dues-ledger-sync.ts` (new file). Exports `syncDuesCreate(tx, payment)`, `syncDuesUpdate(tx, paymentId, patch)`, `syncDuesDelete(tx, paymentId)`. Accepts a Drizzle transaction client `tx`, never `db` directly — callers must wrap in `db.transaction()`.

2. **Atomicity:** The three dues API routes (`POST`, `PATCH`, `DELETE` on `/api/admin/dues/[memberId]`) wrap their existing DB write + the sync helper call in a single `db.transaction()`. The dues write and the ledger write either both commit or both roll back. Exception: if `getAdministrativeFundId()` returns null (configuration error — Administrative fund not seeded), the sync call throws; the catch block inside the transaction logs the error and sets a `syncFailed: true` flag on the response body without re-throwing, so the dues write still commits. This is the one best-effort carve-out: a dues payment without a ledger row is recoverable; a rolled-back dues payment is data loss.

3. **Idempotency:** `ledger_transactions` gains a `dues_payment_id uuid UNIQUE REFERENCES dues_payments(id) ON DELETE SET NULL` column. The unique constraint enforces one ledger row per dues payment. `ON DELETE SET NULL` (not CASCADE) is required: a hard-deleted dues payment must not cascade-delete a possibly-reconciled ledger row.

4. **Reconciled-conflict marker:** `ledger_transactions` gains a `sync_stale boolean NOT NULL DEFAULT false` column. When a dues payment is edited (PATCH) or deleted (DELETE) and its linked ledger row has `reconciled = true`, the sync helper sets `sync_stale = true` on the ledger row without modifying any other financial fields. The dues change proceeds. The dues API returns `{ syncStale: true }` in the response body. The `sync_stale` flag is surfaced in `guardrails()` (`src/lib/ledger.ts`) as a WARN-severity flag fed by a `syncStaleTxns` count added to `getOverview()` in `ledger-queries.ts`.

5. **Dependency direction:** Dues feature → ledger schema. `src/lib/dues-ledger-sync.ts` imports from `src/lib/db/schema.ts` (ledger tables) and `src/lib/ledger-queries.ts` (fund lookup). The ledger feature does not import from the dues feature. This direction is correct: the ledger is core infrastructure (shipped v1.20.0); dues is a feature that posts income to it.

6. **`donor_id` column on `ledger_transactions`:** A nullable `donor_id uuid REFERENCES ledger_donors(id) ON DELETE SET NULL` column is added to `ledger_transactions` to link Foundation income transactions to a donor record (independent of the acknowledgment). The acknowledgment table (`ledger_acknowledgments`) also carries `donor_id` for direct ack-to-donor linkage.

**Rationale:**
Same-transaction-atomic is the correct default for financial writes. The two alternatives considered were: (a) best-effort fire-and-forget (dues write commits first; ledger insert attempted after) — rejected because a crash between the two writes leaves dues recorded without a ledger entry, a silent discrepancy; (b) ledger-first (insert ledger row first, dues payment second) — rejected because failure-mode semantics are harder to reason about and the dues payment is the authoritative record. Atomic-with-catch satisfies both the data-integrity requirement and the practical requirement that a configuration error not block dues recording.

Placing the helper in `dues-ledger-sync.ts` rather than inside `ledger-queries.ts` isolates the cross-feature concern: the ledger query layer should not know about dues payments, and the dues routes should not know about ledger internals. The sync module is the explicit seam.

`ON DELETE SET NULL` on the `dues_payment_id` FK (rather than CASCADE) is required because a reconciled ledger transaction is part of the club's audited financial record; it must not be silently removed because someone deleted its source dues payment. `sync_stale` provides the signal for the treasurer to resolve the discrepancy manually.

**Impact:**
- New file: `src/lib/dues-ledger-sync.ts`.
- `src/lib/db/schema.ts` — `ledgerTransactions` gains `duesPaymentId` (uuid, unique, nullable, FK → dues_payments ON DELETE SET NULL) and `syncStale` (boolean, NOT NULL DEFAULT false) and `donorId` (uuid, nullable, FK → ledger_donors ON DELETE SET NULL).
- New tables in `schema.ts`: `ledgerDonors`, `ledgerAcknowledgments`.
- New idempotent migration: `drizzle/migrations/0051_ledger_donors_acks_dues_sync.sql` (or next sequential number — database-admin assigns).
- `src/app/api/admin/dues/[memberId]/route.ts` (POST) — wrapped in `db.transaction()`, calls `syncDuesCreate`.
- `src/app/api/admin/dues/[memberId]/[paymentId]/route.ts` (PATCH, DELETE) — wrapped in `db.transaction()`, calls `syncDuesUpdate` / `syncDuesDelete`.
- `src/lib/ledger.ts` — new `syncStaleTxns` input to `guardrails()`; new WARN flag.
- `src/lib/ledger-queries.ts` — `getOverview()` adds `syncStaleTxns` count.
- New API routes: `src/app/api/admin/ledger/donors/route.ts`, `src/app/api/admin/ledger/donors/[id]/route.ts`, `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`.
- New proxy route: `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts`.
- New admin pages: `src/app/(dashboard)/admin/ledger/donors/` (list + detail with ack tab or sub-route — tech-lead decides per Suggestion 1).

---

## DECISION-024: `isGiving()` definition — fund-kind+flow+transfer-check only; null-party rows excluded from recent gifts

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Two implementation-level rulings for the Ledger inc5 Impact Dashboard:

1. **`isGiving()` uses fund-kind + flow + transfer-check only — no category keyword matching.** The pure helper in `src/lib/ledger.ts` defines "giving" as: `flow === 'expense'` AND `transferGroupId === null` AND `fund.kind IN ('activity', 'charitable', 'scholarship')`. Category keywords (donation/grant/scholarship/vision/relief/screening) mentioned in the feature doc are NOT part of the definition. The SQL giving predicate in `getPhilanthropy()` in `src/lib/ledger-queries.ts` uses the same three-condition rule. Both definitions carry a cross-reference comment requiring sync.

2. **Null-`party` rows are excluded from the "Recent named gifts" section.** The `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL` so that giving rows without a named recipient do not produce "Unnamed recipient: $X" entries. These rows are fully captured in all-time, current-FY, by-cause, and by-FY totals — only the named-recipients display excludes them.

**Rationale:**

_Category keywords:_ The feature doc lists category keywords as a secondary gate on `isGiving()`. However, categories are free text entered by the treasurer — any keyword list will silently miss transactions with unexpected category names (e.g., "youth program" vs. "Youth Programs"). The fund-kind gate (`kind IN ('activity','charitable','scholarship')`) is deterministic: it enforces the Administrative fund exclusion at the domain boundary and is identical in the pure helper and the SQL predicate. Adding keyword matching on top would diverge: the pure helper would need to check `categoryName`, which is not on the transaction row itself (it requires a join), making the helper no longer "pure." Keeping the rule to fund-kind+flow+transfer-check makes the helper fully testable without DB access and the SQL predicate fully consistent.

_Null party in recent gifts:_ A "Recent named gifts" section has user value when it names specific recipients ("$2,000 to Westerville Food Pantry"). A null-party entry adds no value and would require a placeholder ("Unnamed recipient") that confuses members. The aggregate sections (by-cause, by-FY, all-time total) capture every giving dollar including those without a named payee. Excluding null-party rows from only the recent-gifts display is the minimal change that keeps the section meaningful.

**Impact:**
- `src/lib/ledger.ts` — `isGiving(row, fundKind)` checks `row.flow`, `row.transferGroupId`, and `fundKind` only. No `categoryName` or keyword matching.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()` SQL predicate: `status='posted' AND transfer_group_id IS NULL AND flow='expense' AND fund.kind IN ('activity','charitable','scholarship')`.
- `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL`.
- Vitest tests include a case confirming that `isGiving()` returns true for an `administrative` fund → false (the exclusion is a fund-kind check, not a status or category check).

---

## DECISION-023: `csvCellSafe()` for ledger CSV export — injection guard lives in the export route, not in a shared util; dues `csvCell()` left unchanged

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The ledger CSV export route (`src/app/api/admin/ledger/export/route.ts`) defines its own `csvCellSafe()` helper that extends the dues `csvCell()` logic with a leading-character injection guard: if a cell value's first character is `=`, `+`, `-`, or `@`, a tab character (`\t`) is prepended before any quoting step. This guards against spreadsheet formula injection (CVE-class: CSV injection). The existing `csvCell()` in `src/app/api/admin/dues/export/route.ts` is NOT modified. A Vitest unit test for `csvCellSafe()` is required before the export route ships.

The `csvCellSafe()` helper is applied to every free-text column (Category, Party/Payee, Memo in the transaction CSV; Line/Group and any category-derived label in the 990-prep CSV). Controlled-value columns (Date, Fund, Flow, Amount, Status, Reconciled, Payment Method) use a plain `csvCell()` inline (no injection guard needed — values are server-generated enums or formatted numbers).

**Rationale:**
Placing `csvCellSafe()` in the export route rather than extracting it to a shared util avoids pulling ledger-specific security logic into a file shared by unrelated exports. The dues export fields are all admin-controlled (no free-text from untrusted input); the ledger `party` and `memo` fields are free-text entered by treasurers and could contain `=` or `+`. The two helpers have different correctness requirements. Retroactively patching `csvCell()` in the dues export is out of scope for inc4; that surface will be caught in the next security review. The tab-prepend approach is the standard published defense (OWASP CSV Injection); it is invisible in most spreadsheet apps under normal rendering.

**Impact:**
- New local function `csvCellSafe()` in `src/app/api/admin/ledger/export/route.ts`.
- New Vitest unit test file (location: co-located or in `src/lib/__tests__/csv-ledger-export.test.ts`); minimum 8 cases (see Phase 3 design doc).
- `src/app/api/admin/dues/export/route.ts` — no change.
- Security review must audit whether `csvCell()` in the dues export should also be upgraded; flagged for the next 30-day security review.

---

## DECISION-022: `ledger_filings` 5-year cadence stored as `next_due_year integer`; `listFilings` includes a 5-year row only when `nextDueYear === fiscalYear + 1`

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The `Statement of Continued Existence` (Ohio SOS, every 5 years) and any future `recurrence='5_year'` filing row is controlled by a `next_due_year integer` column on `ledger_filings`. The value is the **calendar year** in which `due_month/due_day` falls for the next required filing (e.g., `next_due_year=2030` means the filing is due `due_month/due_day` in calendar year 2030, which is inside FY2030 for a Lions Jul–Jun FY).

`listFilings(entityId, fiscalYear)` includes a `recurrence='5_year'` row only when `nextDueYear === fiscalYear + 1`. (The `+1` maps a FY start-year to the second calendar year that falls inside it, where months 1–6 land — Nov 15 of FY2029 = Nov 15 2029. Wait — Nov is month 11 ≥ 7, so it lands in the *first* calendar year of the FY. Nov of FY2029 = Nov 2029 = `fiscalYear + 0`. So the correct test for "does this row's due date fall inside `fiscalYear`?" is `nextDueYear === fiscalYear` for months ≥ 7 and `nextDueYear === fiscalYear + 1` for months < 7. Because the Statement of Continued Existence is due Nov 15 (month 11 ≥ 7), the correct test is `nextDueYear === fiscalYear`. `listFilings(2029)` includes the row when `next_due_year = 2029`.)

**Correction on filter predicate:** After applying `computeDueDate` logic (month ≥ 7 → same calendar year as FY start; month < 7 → FY start + 1), the test is:
- Month ≥ 7 (like Nov): `next_due_year === fiscalYear`
- Month < 7: `next_due_year === fiscalYear + 1`

Simplest implementation: `listFilings` computes the expected calendar year for the row's due month (`dueMonth >= 7 ? fiscalYear : fiscalYear + 1`) and compares to `nextDueYear`. Rows that do not match are excluded from the returned set.

On rollover, `ensureFilingsForFY` sets `next_due_year = prior.nextDueYear + 5`. The new row is a copy in the DB for every FY, but surfaces only in the FY where the computed calendar year matches.

**Rationale:**
Two simpler alternatives were considered:
- (a) Store a boolean `isDueThisFY` — requires updating the column every year, which adds write complexity to the rollover and is fragile if a year is skipped.
- (b) Compute the due year entirely from the seed year: `(fiscalYear - seedFY) % 5 === 0` — requires storing the `seedFY` on the row or hardcoding it in the query helper. It also makes the query helper dependent on knowing the original seed year, which would break if the entity's filings are ever re-seeded.

Storing `next_due_year` as an explicit column is the smallest, most self-contained approach: the value is always correct for the row at hand, rollover is a `+5` arithmetic operation, and the filter in `listFilings` is a single equality check. No external seed-year constant needed.

**Impact:**
- `ledger_filings` has a `next_due_year integer` column (nullable for `recurrence='annual'` rows; non-null for `recurrence='5_year'`).
- `listFilings` filters 5-year rows: `row.nextDueYear === (row.dueMonth >= 7 ? fiscalYear : fiscalYear + 1)`.
- `ensureFilingsForFY` sets `next_due_year = CASE WHEN recurrence = '5_year' THEN next_due_year + 5 ELSE NULL END` in the rollover INSERT.
- Migration seed for the Statement of Continued Existence seeds `next_due_year = 2030` (placeholder — the actual next Ohio SOS renewal year should be confirmed with the treasurer before the migration goes to production).

---

## DECISION-021: `ledger_filings` due-date storage — `dueMonth` + `dueDay` integers; rollover is an explicit idempotent `ensureFilingsForFY()` step, not write-on-read

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Two data-shape rulings for the `ledger_filings` table in Ledger inc3 (Compliance):

1. **Due-date column shape:** Store `due_month integer NOT NULL` (1–12) and `due_day integer NOT NULL` (1–31) on `ledger_filings` in place of an absolute `due_date date` column. The absolute due date for display and overdue-check purposes is computed at query time as `make_date(fiscal_year_start_year + 1 if due_month < fy_start_month else fiscal_year_start_year, due_month, due_day)` — for the Lions Jul–Jun FY, months 1–6 land in the fiscal-year's second calendar year and months 7–12 land in the first. `listFilings(entityId, fiscalYear)` materializes each row's `dueDate` from these two columns. The seed data records real month/day pairs (e.g., IRS 990-N: `due_month=11, due_day=15`; Ohio Unclaimed Funds: `due_month=11, due_day=1`). The 5-year `Statement of Continued Existence` carries `recurrence='5_year'`; `listFilings` computes its next due-year at query time by finding the nearest multiple-of-5 boundary from the entity's first filing year.

2. **Auto-rollover mechanism:** The FY materialization is NOT a write-on-read side-effect inside `listFilings`. Instead, a dedicated `ensureFilingsForFY(entityId, fiscalYear)` server-action/helper inserts the next FY's rows (by copying the prior year's `agency`, `title`, `due_month`, `due_day`, `recurrence` and assigning `status = 'not_started'`) if none exist for that FY. This function is idempotent (`INSERT … ON CONFLICT DO NOTHING` keyed on `(entity_id, fiscal_year, agency, title)`). It is called: (a) once as an idempotent seed step in the migration for the current FY; (b) explicitly on first navigation to the compliance page when no rows exist for the requested FY (a server component calls it before rendering). `listFilings` is a pure read; it never inserts.

**Rationale:**

_Due-date shape:_ Storing an absolute `date` per row (e.g., `2026-11-15`) is correct for the seed FY but drifts on rollover — a copy that bumps the year field by 1 works for most rows but silently produces wrong dates for any filing that crosses the calendar-year boundary inside a Jul–Jun FY (e.g., a March filing in FY2026 is March 2027, not March 2026). The month/day column pair + FY-aware computation is deterministic, rollover-safe, and makes the seed data readable without requiring date arithmetic in the migration.

_Rollover mechanism:_ A write-on-read `listFilings` is architecturally problematic: (a) it violates the convention that `GET` requests on this codebase are side-effect-free — a `SELECT` that may do an `INSERT` is invisible to callers, difficult to test, and can produce duplicate-insert races under concurrent requests; (b) the existing codebase has no precedent for write-on-read query helpers, and introducing one would require special-casing in the API route middleware (no read-lock, no idempotency guard). An explicit `ensureFilingsForFY()` call in the server component is consistent with the `getSettings()` + singleton-upsert pattern already in `ledger-queries.ts`, is trivially testable, and its idempotency is provable from the `ON CONFLICT DO NOTHING` clause.

**Impact:**
- `ledger_filings` schema: `due_date date` column replaced by `due_month integer NOT NULL` + `due_day integer NOT NULL`. No `due_date` column in `schema.ts` or the migration.
- New computed-field helper in `src/lib/ledger-queries.ts`: `computeDueDate(fiscalYear, dueMonth, dueDay): Date` (exported; pure).
- `listFilings(entityId, fiscalYear)` returns rows enriched with a computed `dueDate: Date` property — it never inserts.
- New `ensureFilingsForFY(entityId, fiscalYear)` in `src/lib/ledger-queries.ts` (or a co-located `actions.ts`): idempotent INSERT … ON CONFLICT DO NOTHING.
- The compliance page server component calls `ensureFilingsForFY` before `listFilings`.
- Migration seed rows use `due_month` / `due_day` integer pairs.
- Tech-lead must specify the `computeDueDate` boundary rule (month < 7 → FY start year + 1, month ≥ 7 → FY start year) in the Phase 3 design doc. The 5-year cadence for `Statement of Continued Existence` is handled by a separate `nextDueYear` computation, also in tech-lead's design.

---

## DECISION-020: Receipt storage is pluggable via a `ReceiptStorage` interface; proxy routes stream content; store an opaque key, not a provider URL

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Receipt file storage is exposed through a **`ReceiptStorage` interface** (three methods: `save`, `read`, `delete`) with two concrete adapters selected at runtime by environment:

- **`VercelBlobStorage`** (default in production): wraps `@vercel/blob`. Blobs are written under `receipts/<uuid>/<sanitized-name>` with `access: 'public'` but UUID-namespaced. The adapter is lazy-imported (`import()`) inside its module file so that local dev never loads the `@vercel/blob` package.
- **`LocalReceiptStorage`** (default when `BLOB_READ_WRITE_TOKEN` is absent): writes files under a `.receipt-store/` directory in the repo root (added to `.gitignore`). Reads and streams from disk. Requires zero configuration — no env var, no Vercel account.

Selection rule: `getReceiptStorage()` checks `process.env.BLOB_READ_WRITE_TOKEN`; if set, returns a `VercelBlobStorage` instance; otherwise returns a `LocalReceiptStorage` instance.

**Column rename:** `ledger_reimbursements.receipt_url` is renamed to `receipt_storage_key` (`text NOT NULL`). The column stores an opaque, provider-neutral key (e.g., `receipts/<uuid>/<filename>`) — not a full Vercel Blob URL. This is provider-agnostic and works identically for both adapters.

**Proxy routes stream bytes, not redirect.** `GET /api/members/reimbursements/[id]/receipt` and `GET /api/admin/ledger/reimbursements/[id]/receipt` call `getReceiptStorage().read(key)`, then return the raw bytes with `Content-Type: <contentType>` and `Content-Disposition: inline`. They do NOT redirect to any storage URL. The storage URL/path is never sent to the browser. This works identically for Vercel Blob and local-filesystem, and is strictly more private than a redirect.

**Upload route** returns `{ key: string }` (not `{ url: string }`). The key is stored in `receipt_storage_key`. The browser never learns the underlying blob URL or local path.

**`isBlobUrl()` is removed.** Because the upload route returns an opaque key (not a URL) and the column stores that key, there is no external-URL injection surface to validate. The Blob URL allow-list check on PATCH is replaced by a format check: the key must match the pattern `receipts/<uuid>/<filename>` and must exist in the storage (the read call returns null if not).

**`BLOB_READ_WRITE_TOKEN`** is required only in production. It is absent locally, and local dev needs no storage config at all.

**Rationale:**
DECISION-018 mandated Vercel Blob as the production storage provider — this decision does not change that. It adds a pluggability layer that fixes two problems DECISION-018 left open: (1) the original design required `BLOB_READ_WRITE_TOKEN` in local dev even though Vercel Blob cannot be used locally without network access and a real Blob store; (2) the redirect-based proxy model exposed the Vercel Blob CDN URL to the browser for the duration of the browser fetch, creating a window where the URL could be intercepted and reused without auth. Streaming the bytes from the server through the proxy closes that window and makes the two adapters behaviorally identical. The local adapter costs zero production-runtime overhead (never loaded) and zero configuration.

The `ReceiptStorage` interface also future-proofs the design: swapping to Cloudflare R2 or S3 in a future increment is a new adapter module, not a rewrite of upload/proxy routes.

**Impact:**
- New module: `src/lib/receipt-storage/index.ts` (interface + `getReceiptStorage()` factory + re-exports).
- New module: `src/lib/receipt-storage/vercel-blob.ts` (VercelBlobStorage adapter).
- New module: `src/lib/receipt-storage/local.ts` (LocalReceiptStorage adapter).
- `.receipt-store/` added to `.gitignore`.
- `src/lib/blob.ts` is **not created** (superseded by the receipt-storage module).
- `ledger_reimbursements.receipt_url` is **renamed** to `receipt_storage_key text NOT NULL` in migration `0046_ledger_controls.sql` and in `schema.ts`.
- Upload route returns `{ key }` instead of `{ url }`.
- Proxy routes (`GET .../receipt`) stream bytes via `getReceiptStorage().read(key)` instead of redirecting.
- `isBlobUrl()` helper is not needed and is not created.
- Refines DECISION-018.

---

## DECISION-019: Receipt file-type validation — hand-rolled magic-byte check, no `file-type` npm package

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The receipt upload handler in `src/app/api/members/reimbursements/upload/route.ts` validates file type via a **hand-rolled magic-byte inspection** of the first 8 bytes of the uploaded buffer. No additional npm package (`file-type` or otherwise) is added. Supported formats and their byte signatures:

| Format | Bytes checked |
|--------|--------------|
| PDF | `25 50 44 46` (first 4: `%PDF`) |
| JPEG | `FF D8 FF` (first 3) |
| PNG | `89 50 4E 47 0D 0A 1A 0A` (all 8) |

If the buffer does not match any of these signatures, the handler returns 400. Content-Type from the request header is used as a hint for the error message only — the magic bytes are the authoritative check.

**Rationale:**
The `file-type` npm package (~50 KB, MIT, ESM-only) would work correctly for this use case. However, this project must validate exactly three MIME types (PDF, JPEG, PNG). The magic bytes for all three fit in a trivial 10-line helper function. Adding a dependency for three byte comparisons introduces: (1) a package to audit at every `pnpm audit` run; (2) ESM-only compatibility surface to manage in a Next.js App Router project; (3) ongoing maintenance cost if the package releases breaking changes. The hand-rolled check is simpler, has zero maintenance surface, is fully transparent to the reader, and is correct for the use case. The dependency evaluation criteria prefer the option already available — in this case, Node.js `Buffer` comparison — when it solves the problem adequately.

**Impact:**
- No new npm package.
- The magic-byte logic lives in `src/lib/blob.ts` (the `uploadReceipt` helper). It is unit-testable with a three-case Vitest test (valid PDF, valid JPEG, invalid content).
- If a future increment requires a broader set of supported file types (e.g., Word docs, spreadsheets), this decision should be revisited and `file-type` evaluated at that time.

---

## DECISION-018: Receipt file storage for ledger reimbursements — Vercel Blob with server-minted signed URLs

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Receipt files for `ledger_reimbursements` are stored in **Vercel Blob** (`@vercel/blob` npm package, new dependency). Blobs are uploaded server-side from the receipt-upload route handler (never from the browser directly to Blob), minted with `put(path, stream, { access: 'public' })` but placed under a UUID path that is not guessable. All receipt reads from the member portal or admin UI go through a **server-side proxy route** (`GET /api/members/reimbursements/[id]/receipt` for the member, `GET /api/admin/ledger/reimbursements/[id]/receipt` for officers) that verifies session + ownership/permission before redirecting to the blob URL. The blob URL itself is never embedded in HTML or returned in JSON to the client; every access is mediated by a server check.

Required new env var: `BLOB_READ_WRITE_TOKEN` (Vercel Blob store token).

The `receiptUrl` column on `ledger_reimbursements` stores the full Vercel Blob URL (e.g., `https://<store>.public.blob.vercel-storage.com/<uuid>/<filename>`). File-type validation (PDF, JPEG, PNG; max 10 MB) is enforced server-side in the upload handler before writing to Blob.

The existing `receiptUrl` text field on `ledger_transactions` (ordinary transactions, FU-3) remains a paste-URL text field for now — no file-upload UX for ordinary transactions in inc2. The file-storage decision applies only to `ledger_reimbursements` in this increment.

The `public/uploads`-based upload handler at `src/app/api/admin/upload/route.ts` (used for campaign images) is left untouched; that surface is not financial and ephemeral loss there is acceptable. Receipt files are financial documents with a 7-year retention requirement — they require durable object storage.

**Rationale:**
- `public/uploads` + `writeFile` is already used for campaign images and is the only file-upload precedent in the codebase. That handler was confirmed unacceptable for receipts: Vercel's serverless runtime provides no persistent local disk, so any file written to the local filesystem is lost between invocations and certainly lost on redeployment. Financial documents with a 7-year retention requirement cannot use ephemeral storage.
- **Vercel Blob** is the correct fit: the project is deployed on Vercel, Blob is native to the platform (no cross-provider credentials, no separate CDN), it is actively maintained, and the `@vercel/blob` package adds negligible bundle weight to a server-only upload route. License: Apache-2.0.
- **Cloudflare R2 / S3** would work but introduce additional cross-provider credentials (`AWS_ACCESS_KEY_ID`, etc.) and a heavier SDK for a single use-case in a small club app. The dependency evaluation criteria prefer the option that is already available in the deploy environment.
- **Storing blobs in Postgres** (bytea) is rejected: blob columns at multi-MB scale degrade query performance across all tables sharing the DB connection pool and violate the principle of keeping the DB for structured data only.
- The access-control model (server proxy, never raw blob URL to the client) provides defense-in-depth: even if a blob URL were somehow leaked, the server route is the only entry point that links the UUID path back to a member identity or a permission check.

**Impact:**
- New npm dependency: `@vercel/blob`. Add to `package.json` (production dependency).
- New env var: `BLOB_READ_WRITE_TOKEN` — deployment-engineer must document in Vercel environment variables.
- New upload route: `src/app/api/members/reimbursements/upload/route.ts` — accepts a multipart file, validates type + size, calls `put()`, returns the blob URL to the server action (not to the browser). This is a server action or route handler intermediary, not a direct browser-to-Blob upload.
- New receipt-proxy routes: `GET /api/members/reimbursements/[id]/receipt` (auth + memberId ownership check → redirect) and `GET /api/admin/ledger/reimbursements/[id]/receipt` (auth + `LEDGER_VIEW` → redirect).
- `ledger_reimbursements.receiptUrl` column: `text NOT NULL` (required — every reimbursement must have a receipt).
- `ledger_transactions.receiptUrl` remains text (paste-URL) for ordinary transactions — no file upload in inc2 for that surface.
- Security review must audit: upload file-type sniffing (MIME type from Content-Type header is spoofable — server must also inspect the first bytes), size limit enforcement, that the blob path is UUID-namespaced (not predictable), and that the proxy routes return 404 (not 403) for IDs that exist but belong to another member.

---

## DECISION-017: Ledger `flow` column stores `'income' | 'expense'` only; `transferGroupId` is the transfer discriminator

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The `flow` column on `ledger_transactions` takes only two values: `'income'` and `'expense'`. It does NOT store a third value `'transfer'`. For a transfer pair (two linked rows per DECISION-016), the debit row stores `flow = 'expense'` and the credit row stores `flow = 'income'`. The `transferGroupId` UUID column (non-null on both rows of a pair) is the sole discriminator used to: (a) label rows as "Transfer" in the UI, (b) enforce two-row atomic delete/edit, and (c) join transfer pairs in the inc2 firewall guardrail. No check constraint on `flow` may include `'transfer'` as a valid value.

**Rationale:**
DECISION-016 established two linked rows so that `fundBalanceCents()` can be a single-pass sum with no special cases. That property only holds if `flow` encodes the sign direction (`'income'` = positive, `'expense'` = negative) on each row independently. If `flow = 'transfer'` were stored, the balance helper would need to know whether the queried fund is the source (debit) or destination (credit) of each transfer row — reintroducing exactly the asymmetry DECISION-016 was designed to eliminate. The spec and DECISION-016 text reference `flow = 'transfer'` as the *conceptual* category, not a literal column value; this decision binds the implementation to the reading that preserves the single-pass property.

**Impact:**
- `ledger_transactions.flow` check constraint (if any): `flow IN ('income', 'expense')` — no `'transfer'`.
- `fundBalanceCents()` in `src/lib/ledger.ts`: income rows add, expense rows subtract, no other branch needed.
- UI code that renders "Transfer" derives the label from `transferGroupId IS NOT NULL`, not from `flow = 'transfer'`.
- The inc2 firewall guardrail joins on `transferGroupId` and checks `sourceFund.kind` vs `destFund.kind` — it does not filter on a `flow` value.

---

## DECISION-016: Ledger transfer representation — two linked rows via `transferGroupId`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Ledger transfers between funds are stored as **two linked rows** in `ledger_transactions`, not a single row with a `transferFromFundId` annotation. The debit row has `flow = 'expense'`, `fundId = sourceFundId`, and a UUID `transferGroupId`. The credit row has `flow = 'income'`, `fundId = destFundId`, and the same `transferGroupId`. Both rows share the same `entityId`, `txnDate`, `amountCents`, and `memo`. The server action that records a transfer inserts both rows atomically (a single DB transaction). Cross-entity transfers are not defined and must be rejected server-side.

The `flow = 'transfer'` discriminator is retained on both rows (alongside `transferGroupId`) so the UI can render them with a "Transfer" label, suppress the `party` required-field validation on the debit row, and so the inc2 firewall guardrail can detect Activity→Admin flows by joining on `transferGroupId` to find pairs where source `fund.kind = 'activity'` and destination `fund.kind = 'administrative'`.

**Rationale:**
The single-row design (one row, `transferFromFundId` nullable) makes `fundBalanceCents()` asymmetric: the helper cannot be a simple sum over `(fundId, flow)` tuples because transfer rows serve double duty — income for the destination fund, expense for the source fund in the same row. Every balance query and the inc2 guardrail would need to special-case this. The two-row design keeps `fundBalanceCents()` a single-pass sum with no special cases: each fund sums only its own rows. The firewall guardrail becomes a straightforward join on `transferGroupId`. Both the debit and credit appear in their respective fund ledgers as first-class rows, satisfying the audit-trail requirement symmetrically.

**Impact:**
- `ledger_transactions` gains a nullable `transferGroupId uuid` column (no FK — it is a self-join key within the same table).
- `src/lib/ledger.ts` — `fundBalanceCents()` sums all rows for a fund by sign (income positive, expense negative) with no transfer special-case.
- The server action for recording a transfer inserts two rows in a single DB transaction. The form UI collects source fund, destination fund, amount, date, memo — one submission.
- `flow = 'transfer'` is still a valid discriminator value and appears on both rows of a transfer pair.
- `transferFromFundId` column from the spec prototype is dropped — that was a demo-prototype artifact, not a schema commitment.

---

## DECISION-015: Fiscal-year convention is start-year, shared via `src/lib/fiscal-year.ts`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The Lions fiscal year (Jul 1 – Jun 30) is labeled by its **starting** calendar year everywhere in the app: `FY2026 = Jul 1 2026 – Jun 30 2027`. The helpers `getFiscalYear` / `currentFiscalYear` / `fiscalYearLabel` are extracted from `src/lib/dues.ts` into a single shared module `src/lib/fiscal-year.ts` (re-exported from `dues.ts` for back-compat). The forthcoming Ledger accounting feature imports from `@/lib/fiscal-year` rather than redefining it.

**Rationale:**
The Ledger prototype (`Westerville_Lions_Ledger.html`) labeled the same 12 months by their **ending** year (`FY2026 = Jul 2025 – Jun 2026`) — off by one from the shipped dues feature. Two features disagreeing on what "FY2026" means would cause treasurers to record dues and accounting against different windows and mis-file. The transparency doc's per-capita cycle (Jul 2026 → Jun 2027 as one Lions year) matches the start-year labeling already shipped in dues, so we standardize on it and give it one home.

**Impact:**
New file `src/lib/fiscal-year.ts`; `dues.ts` now re-exports the three helpers (no behavior change — dues was already start-year, so no data migration). The Ledger spec (`docs/features/the-ledger-accounting.md`, §2) and all future ledger fiscal-year math depend on this module. The prototype's end-year labeling is explicitly dropped.

---

## DECISION-014: Dues Tracking scope expansion — treasurer role, two-amount dues_settings, dues_category on members, new permission keys

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Five implementation-level decisions added in the Phase 3 loop-back revision after scope expansion (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **New `treasurer` role seeded at sort_order 3.** The existing role order (admin=1, board_member=2, member=3, volunteer=4) gains `treasurer` at position 3; `member` shifts to 4, `volunteer` to 5. The migration uses conditional UPDATEs (`WHERE name = 'member' AND sort_order = 3`) to make the bump idempotent. `ROLES.TREASURER = "treasurer"` added to `src/lib/permissions.ts`.

2. **Two permission keys replace the old single `dues.view` / `membership.manage` design.**
   - `FEATURES.DUES_VIEW = "dues.view"` — read gate. Bound to `admin` + `board_member` + `treasurer`.
   - `FEATURES.DUES_MANAGE = "dues.manage"` — write gate. Bound to `admin` + `treasurer` ONLY. `membership.manage` is NOT the dues write gate. Membership managers who are not admins or treasurers have no dues write access.
   - All read surfaces gate on `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`. All write surfaces gate on `hasFeature(DUES_MANAGE)`. CSV export gates on `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`.

3. **`dues_settings` holds two amounts per fiscal year.** The single `expected_amount_cents` column from DECISION-013 does not exist. The table has `individual_amount_cents` and `family_amount_cents` instead. The status query resolves the applicable amount with a CASE expression keyed on `m.dues_category`. FY2026 seed: individual 12000 cents ($120.00), family 9600 cents ($96.00).

4. **New `members.dues_category` column (`text NOT NULL DEFAULT 'individual'`).** Values: `individual | family`. Set by treasurer/admin on the per-member dues detail page via `PATCH /api/admin/dues/[memberId]/category`. Existing members default to `individual` via the column default. Changing the category retroactively recomputes status for all fiscal years (acceptable at club scale; documented in UI).

5. **Named treasurer role assignments in migration.** Chris Henson (chenson42@gmail.com) and James Shively (jmshively@gmail.com) receive the `treasurer` role via idempotent email-keyed `user_roles` INSERTs in `0040_dues_tracking.sql`. Email keys (not UUID) ensure the migration works in production without hardcoding environment-specific IDs.

**Rationale:** A separate `treasurer` role with its own permission key keeps financial write access narrowly scoped without requiring new UI for role management. The two-amount design is the minimal extension for a family discount: one row per year, two columns, resolved at query time. Putting `dues_category` on the member (not per payment or per fiscal year) reflects the reality that membership type is a stable attribute of the person, not a per-year decision. Email-keyed user assignments are idempotent across environments.

**Impact:**
- `src/lib/db/schema.ts` — `duesCategory` column on `members`; `individualAmountCents` + `familyAmountCents` on `duesSettings` (no `expectedAmountCents`).
- `src/lib/permissions.ts` — `DUES_VIEW`, `DUES_MANAGE` in `FEATURES`; `TREASURER` in `ROLES`.
- `drizzle/migrations/0040_dues_tracking.sql` — DDL + treasurer role seed + sort_order bumps + FY2026 seed + user_roles bindings.
- `drizzle/migrations/0041_dues_permissions.sql` — both feature rows + role bindings.
- `src/lib/dues.ts` — `deriveStatus()` takes `(totalPaidCents, expectedCents | null)`.
- New API endpoint: `PATCH /api/admin/dues/[memberId]/category`.
- New admin component: `DuesCategoryControl` on per-member detail page.
- New admin component: `DuesConfigureModal` (two-input) on dues list page.

**Amends:** DECISION-013 — the Impact bullet for `dues_settings.expected_amount_cents` is superseded. The fiscal-year integer convention and integer-cents storage decisions in DECISION-013 remain valid and unchanged.

---

## DECISION-013: Dues Tracking — fiscal year as starting integer, amounts as integer cents, status derived on read

**Status:** Resolved (Impact amended by DECISION-014 — `dues_settings` has two amount columns, not one)
**Date:** 2026-06-24

**Decision:**
Three implementation-level data choices for the `dues_payments` and `dues_settings` tables:

1. **Fiscal year stored as a single integer (the starting calendar year).** FY2026 = Jul 1 2026 – Jun 30 2027 is stored as `fiscal_year = 2026`. The helper `getFiscalYear(date)` in `src/lib/dues.ts` maps any payment date to this integer: if the month is January–June (0–5), return `year - 1`; if July–December (6–11), return `year`. This avoids storing a date range per year and avoids any ambiguity about which year a row belongs to. Display label is `FY2026 (Jul 2026 – Jun 2027)`.

2. **Amounts stored as integer cents.** `amount_cents: integer` avoids floating-point rounding on financial values. The UI divides by 100 for display and multiplies by 100 on input. Negative values represent refunds/reversals. Zero is disallowed at the application layer (validated before insert).

3. **Dues status (Paid / Partial / Unpaid) computed on read, never stored.** Status = `COALESCE(SUM(amount_cents), 0)` for a `(member_id, fiscal_year)` pair, compared to the applicable `dues_settings` amount for that year (individual or family, per DECISION-014). No denormalized status column on `members` or `dues_payments`. This eliminates the risk of stale cached status and keeps the data model minimal; the club's scale (~100 members) makes the GROUP BY query negligible.

**Rationale:** Integer fiscal year is unambiguous and queryable with a simple equality filter. Integer cents is standard practice for financial storage at any scale. Derived status avoids the class of bugs where a stored flag diverges from the actual payment sum after an edit or delete.

**Impact:**
- `dues_payments.fiscal_year`: `integer NOT NULL`
- `dues_payments.amount_cents`: `integer NOT NULL` (non-zero enforced at app layer)
- `dues_settings`: two amount columns — `individual_amount_cents` and `family_amount_cents` (see DECISION-014; the single `expected_amount_cents` column is superseded)
- `src/lib/dues.ts` — new file: `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`
- No stored status column anywhere.

---

## DECISION-012: Dues Tracking — separate `/admin/dues` route, `DUES_VIEW` permission key, CSV via Response + manual encoding, member-portal path reserved

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Four structural rulings for the Annual Membership Dues Tracking feature (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **Separate `/admin/dues` route, not a tab under `/admin/membership`.** The existing `/admin/membership` route is scoped to membership *applications* (the `membership_applications` table). Dues tracking is a financially distinct domain (a `dues_payments` table linked to `members`). Merging the two would conflate a one-time intake workflow with a recurring per-year ledger, creating a surface with two unrelated data models and two unrelated permission audiences. The new route lives at `src/app/(dashboard)/admin/dues/` with its own top-level sidebar entry, gated on the new `DUES_VIEW` key. A sub-route at `src/app/(dashboard)/admin/dues/[memberId]/` holds per-member detail. The admin API handlers live under `src/app/api/admin/dues/`.

2. **New `DUES_VIEW` feature key added to the `FEATURES` catalog.** The analyst's Option A (new `dues.view` key, bound to `board_member` and `admin`) is the architecturally correct choice. Option B (grant `membership.manage` to `board_member`) would give board members write-API access even when the UI hides controls — a quiet invariant violation. `DUES_VIEW` becomes the read gate; `MEMBERSHIP_MANAGE` remains the write gate. Page-level and API-level checks use `hasFeature()` with these two keys; no second gating mechanism is introduced.

3. **Export uses `Response` with hand-rolled CSV, not `exceljs`.** The existing `exceljs` export produces an `.xlsx` file targeted at Zeffy's import format. The dues export is a plain auditor CSV (name, email, year, amount, status). Adding a 1 MB+ Excel workbook for six columns of plain text is not justified. A hand-rolled `text/csv` response — already a supported output of the native `Response` API in Node — keeps the bundle clean. `exceljs` is not introduced as a new dependency for this surface.

4. **Member self-view path reserved at `/members/dues` but not built in this increment.** If member self-view is added later, it lives in the existing `src/app/members/` route group (already authenticated), not in `/(dashboard)/admin`. No code is written for this path now; the reservation is noted so the data model (Phase 3) does not foreclose it.

**Rationale:** Separating dues from membership applications keeps each admin surface coherent. A new permission key is the only correct enforcement model for the read-vs-write split. Hand-rolled CSV avoids a new dependency. Reserving the member self-view path prevents a schema decision from accidentally locking out the future increment.

**Impact:**
- `src/app/(dashboard)/admin/dues/` — new route directory (Phase 4).
- `src/app/(dashboard)/admin/dues/[memberId]/` — new sub-route for per-member detail (Phase 4).
- `src/app/api/admin/dues/` — new API route directory (Phase 4).
- `src/components/admin/admin-sidebar.tsx` — new "Dues" entry gated on `DUES_VIEW` (Phase 4).
- `src/lib/permissions.ts` — `DUES_VIEW: "dues.view"` added to `FEATURES` (Phase 4, via add-permission skill).
- `drizzle/migrations/` — idempotent migration binding `dues.view` to `admin` and `board_member` roles (Phase 4, via add-permission skill).
- No new npm dependencies introduced.

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

**Status:** Resolved (Impact bullet about `generateOccurrences` partially superseded by [DECISION-002](#decision-002-generateoccurrences-signature-unchanged-only-getnextoccurrence-gains-cancellation-exclusion))
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
- ~~`src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.~~ **Superseded by DECISION-002:** the parameter was placed on `getNextOccurrence` (and its `findNextDayOfWeek` helper) instead. `generateOccurrences` is unchanged.
- `src/types/events.ts` — `OccurrenceRow` gains `isCancelled: boolean` and `cancellationReason: string | null`.
- No new npm dependency. No new `FEATURES` key. No new role binding.

---

<!-- Decisions are appended above this line, newest first. -->
