# Prospective Members (club@ list access before induction) — Work Log

> **Slug:** `2026-07-26-prospective-members`
> **Surface:** (dashboard) admin — primary; touches member portal login gate and public-facing email delivery indirectly
> **Permission(s):** existing `FEATURES.MEMBERS_EDIT` likely covers status changes; open question below on whether a narrower key is warranted
> **Estimated complexity:** medium (schema change with wide blast radius — `isActive` is read in 6+ query surfaces — but no new UI surface beyond the existing member form/list)
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-26 |
| 4 — Implementation (schema) | database-admin | Complete | — | 2026-07-26 |
| 4 — Implementation (server) | api-developer | Complete | — | 2026-07-26 |
| 4 — Implementation (client) | ux-developer | Complete | — | 2026-07-26 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Chuck wants a third member lifecycle state — "engaged but not yet dues-paying" — that rides the club@ email list, and the request is sound, but it collides with a boolean (`members.isActive`) that six different surfaces already read as "count this person as a real member," so the notes below (not just the schema) are load-bearing for Phase 2/3.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin | Add a person to the roster as **prospective** (not yet active, not applying dues) | On demand, whenever someone like Leonaida shows up between induction cycles |
| Admin | Change a member's status: prospective → active (induct them) | One-time per person, timed to fiscal-year rollover or whenever the board inducts |
| Admin | Change a member's status: prospective → ended (they never followed through) | On demand |
| Admin | Approve a pending membership application (existing flow) and have it correctly land on club@ immediately | Every approval, going forward (this is the bug-fix half of the request) |
| Prospective member (indirect, non-portal) | Receive club@ emails | Passive — no login, no UI, just inbox |
| Admin | See, at a glance, who on the roster is prospective vs. active vs. ended | Every visit to `/admin/members` |

Note what's absent: Chuck did not ask for a prospective member to log in, RSVP to events, or appear in the member directory. Don't assume any of those — see Gaps below.

## Flows

**Flow 1 — Admin adds a prospective member (the Leonaida case)**
Entry: `/admin/members/new` (existing "Add Member" form)
→ Admin fills in name/email/phone as today
→ Admin sets a new status control to **Prospective** (replacing or sitting alongside the current "Active Member" checkbox)
→ Submit
→ Success: member row created with prospective status; club@ sync fires and adds her email; admin sees the new row in `/admin/members` with a distinguishable "Prospective" badge.
→ **Failure path (not in the request, needs one):** email already exists on another member row → today this is a 409 surfaced inline near the email field (`member-form.tsx` `emailError` state) — that pattern should carry over unchanged. Google Group sync failure (bad email, API outage) → today this is silent-ish (logged to `google_group_sync_log`, fire-and-forget); the admin who just added Leonaida gets no in-page signal that her email didn't actually land on club@. That gap already exists for regular members and would now also apply to prospects — worth a toast or an inline "last sync: ok/failed" indicator, at minimum surfaced via the existing sync-log page.

**Flow 2 — Induct a prospective member (prospective → active)**
Entry: `/admin/members/[id]/edit` (existing edit form)
→ Admin changes status from Prospective to Active
→ Submit
→ Success: member now counted for dues in the current fiscal year, appears in "Total Members" admin stat, appears in directory (if in scope — see gap below), club@ sync unaffected (already on the list).
→ **Failure path (not in the request, needs one):** none currently exists for this transition — what if the admin inducts someone mid-cycle and the dues amount/category isn't set? Today `duesCategory` defaults to `'individual'` so this degrades gracefully, but nothing prompts the admin to confirm dues category at induction time.

**Flow 3 — Prospective member never joins (prospective → ended)**
Entry: `/admin/members/[id]/edit`
→ Admin sets status to Ended, optionally back-fills `membershipEndedDate`
→ Submit
→ Success: club@ sync removes their email on next sync run (fire-and-forget, same as today for any deactivated member); dues and directory unaffected (never included).
→ Failure path: none needed beyond what exists — this mirrors today's "deactivate a member" flow.

**Flow 4 — Membership application approval fires club@ sync (the named bug fix)**
Entry: `/admin/membership` → click Approve on a pending application (`ApplicationActionButtons` → `PATCH /api/admin/membership-applications/[id]`)
→ Today: application marked approved, `members` row inserted with `isActive: true`, `provisionUserForMember` runs (creates portal login + welcome email) — but `syncClubMembersList()` is never called.
→ Fix: call `syncClubMembersList({ triggerSource: "member_added", triggeredByUserId: session.user.id })` after the insert, same as the existing member-create route already does.
→ Success: new member receives club@ mail immediately instead of waiting for the next manual "Sync Club List" click or the next unrelated member edit to trigger a sync.
→ **Failure path (not in the request, needs one):** if sync fails, the approval itself should still succeed (fire-and-forget, matching the existing pattern in `POST /api/admin/members`) — don't let a Google API hiccup block approving a person. Confirm the fire-and-forget call doesn't accidentally get `await`-ed into the response path in a way that changes the endpoint's success/failure semantics for the admin.

**Flow 5 (new question, not in the original request) — Admin approves an application but wants to land the person as prospective, not active**
This is the actual Leonaida scenario if she'd gone through the formal application rather than being hand-added. Today `PATCH /api/admin/membership-applications/[id]` only supports `action: "approve" | "reject"`, hard-coding `isActive: true`. If the club wants "approve now, induct in July" to be a normal path (not just a manual admin add), this endpoint needs a third outcome. **The user's scope decision didn't ask for this — flagging as a likely-real need the request didn't mention**, since the motivating case is exactly "approved in spirit, but asked to wait." See Open Questions.

## Permissions

- **Status changes (prospective/active/ended):** existing `FEATURES.MEMBERS_EDIT` covers this — it already gates all three member-mutation routes (`POST /api/admin/members`, `PATCH /api/admin/members/[id]`, the manual sync button). No new feature key needed for the core toggle.
- **Membership application approval:** existing `FEATURES.MEMBERSHIP_MANAGE` already gates `PATCH /api/admin/membership-applications/[id]` — the sync-on-approve fix doesn't need a new key either.
- **Default roles:** whichever roles currently hold `MEMBERS_EDIT` and `MEMBERSHIP_MANAGE` today (typically Admin/board-level roles) — no widening implied by this feature.
- If Phase 3 decides prospective members should be visible to rank-and-file members in the directory (see gap below), that's a `MEMBERS_VIEW`-gated read, already the correct key — no change needed there either.

## Gaps the Request Didn't Address

- **`isActive` is overloaded across six surfaces today; the request only asked to change one of them.** Grounded in the actual queries:
  1. `syncClubMembersList()` (`src/lib/google-groups.ts` ~line 141) — club@ inclusion. **Chuck wants prospects IN here.**
  2. `listMemberDuesStatus` / `getDuesMethodTotals` (`src/lib/dues-queries.ts` ~lines 141, 202) — dues billing population. **Chuck explicitly wants prospects OUT here.**
  3. Member directory (`src/app/members/page.tsx` line 17) — filters `isActive = true`. Not addressed — see next bullet.
  4. Admin dashboard "Total Members" stat (`src/app/(dashboard)/admin/page.tsx` line 31) — counts `isActive = true`. Not addressed. Counting Leonaida here before she's inducted would overstate real membership to the board.
  5. Admin members list default view and CSV export (`src/app/(dashboard)/admin/members/page.tsx`, `src/app/api/admin/members/export/route.ts` line 34) — both key off `isActive`. Not addressed.
  6. **Portal login gate** — `src/lib/auth/index.ts` blocks sign-in for `!user.isActive` on both the credentials path (line 67) and the Google OAuth path (line 114), and `PATCH /api/admin/members/[id]` (line 97) actively syncs `members.isActive` onto the linked `users.isActive` on every edit. A single boolean cannot be `true` (to satisfy #1) without also flipping the login gate open, unless status becomes its own column distinct from `isActive`. **This is the central finding: a 3-state `membershipStatus` column should be added alongside `isActive`, not replacing it in a way that changes its current semantics everywhere it's read — architect/tech-lead need to decide whether `isActive` becomes a derived/computed value from status, or whether status is additive and each of the 6 call sites above gets an explicit re-check.** Recommend: `isActive` continues to mean "counts as a real, dues-liable, directory-listed member" (i.e., `status = 'active'`), and club@ sync becomes the one place that queries `status IN ('active', 'prospective')` instead of `isActive = true`. That keeps 5 of 6 surfaces correct with zero code change and isolates the new behavior to `google-groups.ts`.
- **Should a prospective member get a portal account?** `provisionUserForMember` (`src/lib/members.ts`) creates a `users` row, assigns the `member` role, generates a password-set token, and sends a "Welcome to the Westerville Lions Club — Set Up Your Account" email. If an admin adds Leonaida as prospective and this fires, she gets full portal access (directory, RSVP, groups) before she's actually a member, and a welcome email that oversells her status. Recommend: the admin "Add Member" path should call `provisionUserForMember` only when status is `active`, not `prospective` — prospective members get an email-list subscription and nothing else, matching Chuck's literal ask ("so they get emails to club@"). This needs an explicit decision, not an assumption.
- **Directory visibility.** Not stated. Recommend prospective members are excluded from `/members` (the directory) by default — they aren't full members yet and showing them there implies a status they don't have. Confirm with Chuck.
- **`joinDate` semantics for a prospect who is later inducted.** The `members` table has one `joinDate` field. If it's set the moment Leonaida is added as prospective, her Lions "years of service" and any tenure-based recognition would start early; if it's left null until induction, that's more correct but means the admin has to remember to set it later. Recommend: `joinDate` is set at induction (prospective → active transition), not at prospective creation. Flag for tech-lead to decide whether this needs to be enforced in code or is just an admin-process convention.
- **Empty state / first prospect.** No install-specific empty state needed here — the admin members table already renders correctly with any mix of statuses. Non-issue.
- **Email queue.** Chuck's whole ask is about email delivery via Google Groups (club@), not `sendEmail()`/Resend — no transactional email is implied for the prospective-member creation itself (unless the portal-welcome-email question above resolves to "yes, send something," in which case it should go through the existing `sendWelcomeEmail` → `sendEmail()` → `email_queue` path, unchanged).
- **Google Group sync for committees/groups (not just club@).** `syncGoogleGroup()` (the per-committee sync) joins `groupMemberships` to `members` with **no `isActive` filter at all** — so today, any member row with a `groupMemberships` entry syncs to that committee's Google Group regardless of active status. This means a prospective member added to a committee would already sync to that committee's list under current code, independent of whatever gate we add for club@. Not necessarily wrong, but worth naming since it's an inconsistency the request didn't ask about and Phase 3 shouldn't "fix" it as a side effect of this feature.
- **Brand/UI:** the existing "Active Member" checkbox in `member-form.tsx` (line 433-448) needs to become a 3-option control (radio group or select: Prospective / Active / Ended), not a second checkbox bolted on — a checkbox plus a status field would be redundant and confusing. The admin members list's Active/Inactive badge (lines 297-305 of `admin/members/page.tsx`) needs a third visual state; use existing badge conventions (`rounded-full` badges are already the established pattern there for status pills, distinct from the `rounded-lg` button rule — that's correct as-is, not a violation).

## Out of Scope (confirm with user)

- Automatically inducting prospects at fiscal-year rollover (a scheduled/cron transition). Chuck's flow implies a manual admin action ("wait until July"); nothing suggests this should be automatic. Confirm it stays manual.
- Any change to the public `/join` application form itself. Out of scope — this is an admin-roster and sync fix, not a public-facing form change.
- Notifying a prospective member by email when their status changes (e.g., "you've been inducted!"). Not requested. If wanted, it's an easy follow-on through the existing `sendEmail()` path but should be its own explicit ask.

## Open Questions

1. **Does a prospective member get a portal login at all**, or purely the club@ email subscription with no `users` row / no welcome email? (Recommend: no portal account until active — confirm with Chuck.)
2. **Should prospective members appear in the member directory** (`/members`)? (Recommend: no, until active.)
3. **Should `/admin/membership` application approval gain a third action — "Approve as Prospective"** — so a formal applicant can land in the same "wait for July" state Leonaida is in informally, or is manual admin-add via `/admin/members` the only intended entry point for prospective status? This directly matches the motivating case and feels like a real gap, not scope creep — worth a direct answer from Chuck.
4. **What happens to `joinDate` on the prospective → active transition** — does the admin re-enter it manually at induction, or should the system stamp it automatically at that transition?
5. **Naming:** is "Prospective" the term the board wants on-screen, or does Chuck have club-specific language (e.g., "Provisional," "Pending Induction")? Cosmetic, but worth a one-line confirmation before Phase 4 UI copy is written.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

The `membershipStatus` model and the `isActive`-untouched split are structurally sound and I'm confirming both, with one correction to the locked plan (a real provisioning bug the analyst's six-surface list didn't name) and a set of suggestions (DB-level CHECK constraint, script updates, admin-list filter tab) that don't block Phase 3 but should be in the design doc.

## The core invariant (this is the ruling that resolves the "crux" question)

**`isActive` becomes a fully derived boolean: `isActive = (membershipStatus === 'active')`. It is not touched, widened, or repurposed — it keeps meaning exactly what it means today ("counts as a real, dues-liable, portal-eligible member").** Legal combinations, no others:

| membershipStatus | isActive |
|---|---|
| `active` | `true` |
| `prospective` | `false` |
| `ended` | `false` |

This is the reconciliation the analyst flagged as undecided: prospective members read `isActive = false`, same value as `ended`. That's correct and desirable — it means every one of the "hide prospects" surfaces (dues, admin stat, CSV export) needs **zero code change**, because they already filter on `isActive = true`, which already excludes prospects for free. The only two surfaces that need to change are the two the analyst already named as changing: club@ sync (to *include* prospects) and the directory (to *include* prospects, per the locked decision #3 the analyst didn't have when writing Phase 1). Both of those move off `isActive` entirely and onto an explicit `membershipStatus`-aware filter — they do not renegotiate what `isActive` means.

Because `isActive` is derived, no route handler should accept `isActive` as client-submitted input going forward — the server computes it from the submitted `membershipStatus` on every insert/update. This closes off the possibility of an admin-form bug ever producing `status='prospective', isActive=true` (which would leak a prospect into dues billing) or `status='active', isActive=false` (which would silently block a real member's login).

## Definitive read-surface enumeration

**Stays on `isActive`, zero code change (verified correct under the derived-boolean rule):**
1. `listMemberDuesStatus` / `getDuesMethodTotals` (`src/lib/dues-queries.ts` lines 141, 202) — `WHERE m.is_active = true`. Correctly excludes prospects.
2. Admin dashboard "Total Members" stat (`src/app/(dashboard)/admin/page.tsx` line 31) — `eq(members.isActive, true)`. Correctly excludes prospects.
3. Admin members list default filter (`src/app/(dashboard)/admin/members/page.tsx`, `status === "active"` branch) — correctly excludes prospects from the default view.
4. CSV/Zeffy export (`src/app/api/admin/members/export/route.ts` line 34) — correctly excludes prospects.
5. Portal login gate, both providers (`src/lib/auth/index.ts` lines 67, 114) — reads `users.isActive`, kept in sync from `members.isActive` by `PATCH /api/admin/members/[id]` line 97. Moot for prospects directly (they never get a `users` row — see write-path section below), but the derived rule means if one ever existed it would correctly stay locked out.
6. Google-sign-in auto-link-by-name query (`src/lib/auth/index.ts` line 171, `eq(members.isActive, true)`) — correctly refuses to auto-link a Google sign-in to a *prospective* member's record. Desirable: no portal identity attaches to a prospect until induction.

**Switches to an explicit `membershipStatus`-aware filter (named in the locked decisions, confirming the exact spots):**
7. `syncClubMembersList()` (`src/lib/google-groups.ts` lines 141–144) — change `and(eq(members.isActive, true))` to `inArray(members.membershipStatus, ["active", "prospective"])`. Use an explicit allow-list of the two statuses, not `ne(..., "ended")` — a future fourth status shouldn't silently ride onto club@ without a deliberate code change.
8. Member directory query (`src/app/members/page.tsx` line 17) — change `eq(members.isActive, true)` to the same `inArray(members.membershipStatus, ["active", "prospective"])`.

**New reads, don't exist today:**
9. Directory row/badge component (whatever renders rows under `src/components/members/member-directory.tsx`) needs `membershipStatus` passed through to render a "Prospective" badge.
10. Admin members list status pill (`src/app/(dashboard)/admin/members/page.tsx` lines 297–305) — currently a binary Active/Inactive `rounded-full` pill keyed on `member.isActive`. Needs a third visual state keyed on `member.membershipStatus` (Active / Prospective / Ended). Keep the existing `rounded-full` pill convention — that's correct today and stays correct with three states.
11. `member-form.tsx` (lines 433–448) — the "Active Member" checkbox is replaced by a 3-option control (radio group or `<select>`, per the analyst's note) bound to `membershipStatus`. The form must stop submitting `isActive` at all; per the invariant above, the API derives it server-side.

## A gap the locked decisions don't cover — flagging before Phase 3, not relitigating scope

**Decision #2 ("prospects get no portal login, `provisionUserForMember` must not run") is not automatically satisfied by adding the column — two existing write paths call it unconditionally or near-unconditionally, and one required write path (induction) doesn't call it at all today:**

- `POST /api/admin/members` (`src/app/api/admin/members/route.ts` lines 108–117) — **calls `provisionUserForMember` unconditionally on every member creation, regardless of any status field.** This is the Leonaida flow's literal entry point (Flow 1, "Add Member" form). Left as-is, adding `membershipStatus` to the form without gating this call means every prospective add would still wrongly provision portal login + fire the welcome email — silently defeating decision #2 on day one. **Must become conditional on `membershipStatus === "active"`.**
- `PATCH /api/admin/members/[id]` (`src/app/api/admin/members/[id]/route.ts` lines 101–125, the "defensive: provision if email changed and no linked user" block) — same problem on edit: changing a prospect's email today would auto-provision them a login. **Must also gate on the post-update `membershipStatus === "active"`.**
- **The prospective → active transition (induction) has no provisioning path at all today.** `PATCH /api/admin/members/[id]` only auto-provisions when an email changes and no linked user exists — it has no branch keyed on a status transition. Inducting Leonaida in July, as written today, would flip her `membershipStatus` to `active` and leave her with no portal account, forever, unless the admin *also* happens to edit her email in the same request. **Tech-lead must design an explicit branch:** when `existing.membershipStatus !== "active" && data.membershipStatus === "active"` and no linked user exists, call `provisionUserForMember`. This is new behavior the locked decisions imply but don't spell out — call it out explicitly in the Phase 3 doc rather than let it fall through as an assumed side effect of the email-changed check.
- `PATCH /api/admin/membership-applications/[id]` (decision #5's new "Approve as Prospective" branch) — structurally must be a separate code path from "Approve" that never calls `provisionUserForMember`, not a shared call gated by a flag. Keep the two branches visually and structurally distinct in the route so a future edit to one doesn't accidentally leak into the other.

## Migration / schema

- Add to `src/lib/db/schema.ts` first: `membershipStatus: text("membership_status").notNull().default("active")` on the `members` table (schema is source of truth — code change precedes migration).
- Idempotent migration (new file, next number is `0061_members_membership_status.sql` per the highest existing migration `0060`):
  ```sql
  ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active';

  -- Backfill: existing isActive=true rows already correctly default to 'active'.
  -- Existing isActive=false rows were "ended" under today's semantics — there's no
  -- historical signal that any of them were prospective, so backfill them to 'ended'.
  UPDATE members SET membership_status = 'ended' WHERE is_active = false AND membership_status <> 'ended';
  ```
- **Suggestion (not a blocker):** a DB-level CHECK constraint enforcing `is_active = (membership_status = 'active')` would make the invariant unbreakable instead of merely application-enforced. I did not find a CHECK-constraint precedent anywhere in `drizzle/migrations/` (the existing 60 migrations are all `ADD COLUMN IF NOT EXISTS` / seed-guard style), so this would be a new pattern for this codebase — recommend it to tech-lead as an optional hardening step, not a requirement, since the write-path fixes above are the load-bearing fix either way.
- **Real finding this surfaced:** `scripts/import-roster.ts` line 118 sets `isActive: row.Status === "Active Member"` directly, with no `membershipStatus`. After this migration, any row that script inserts/updates would default to `membershipStatus = 'active'` regardless of the `isActive` value it computes — violating the invariant for any roster row where `isActive` comes out `false`. **This script (and check `scripts/sync-roster.ts` too) needs a matching `membershipStatus` mapping in Phase 4**, or — if the optional CHECK constraint above is adopted — the script's writes would simply fail loudly instead of drifting silently, which is arguably the safer outcome. Either way, name it in the Phase 3 doc so it isn't discovered in production.

## `joinDate` — confirming the analyst's framing, no schema change

- `joinDate` is set at induction (prospective → active), never at prospective creation. No enforcement needed beyond "the induction API call sets `joinDate = new Date()` if it's still null" (tech-lead's call whether that's automatic or admin-confirmed at the induction step — either is fine architecturally).
- **"Date added as prospect" already exists — `members.createdAt`.** No new column needed; this directly answers the analyst's open question 4's implicit ask. Don't add a second timestamp column for this.

## Directory implementation — high-level (component design left to tech-lead)

- `src/app/members/page.tsx` stays a Server Component — no interactivity is added by this feature, so no `'use client'` boundary crosses here. Query change only (item 8 above).
- The badge itself is a static render, not stateful — belongs in whatever Server Component currently renders each directory row (`src/components/members/member-directory.tsx` per the existing file layout), not a new client component. A "Prospective" pill next to the existing group/position tags is the natural placement; follow the `rounded-full` pill convention already used for group tags on this page (not the `rounded-2xl` card convention — that's for the card container, not an in-card badge).

## Dependencies

None required. Text column + Drizzle `inArray`/`eq`, both already in use throughout the codebase. No new package needed against any of the five evaluation criteria.

## Permissions — confirmed, no gaps

- `FEATURES.MEMBERS_EDIT` correctly gates every status-mutation route (`POST /api/admin/members`, `PATCH /api/admin/members/[id]`) — no change.
- `FEATURES.MEMBERSHIP_MANAGE` correctly gates `PATCH /api/admin/membership-applications/[id]`, including the new "Approve as Prospective" action — it's a third value of the same `action` field on an already-gated route, not a new surface. No new key needed.
- `FEATURES.MEMBERS_VIEW` already gates the admin members list read; the member directory (`/members`) is a general authenticated-portal page (checks `session?.user` only, no feature gate, unchanged by this feature) — consistent with how it works today for every other member-portal page.
- Confirmed: **no new `FEATURES.*` key for this feature.**

## Invariant compliance

- **Server/client boundary:** no new client-side interactivity required. `member-form.tsx` is already `'use client'` (existing interactive form) — the 3-way status control fits inside its existing boundary, nothing new crosses server/client.
- **Migrations idempotent:** confirmed — `ADD COLUMN IF NOT EXISTS` + a backfill `UPDATE` guarded by a `WHERE` clause that becomes a no-op on re-run, matching this repo's established migration style.
- **No native dialogs:** not implicated. If Phase 3 wants a distinct destructive "End membership" action separate from the existing edit-and-save flow, it must use `<ConfirmDialog>` — but if it's just a dropdown value change under the existing Save button (as today), no new confirm is required. Tech-lead's call.
- **Permissions gating:** confirmed above, no gaps.
- **Directory/placement:** no new top-level module or directory needed. All touched files sit inside existing directories (`src/lib/db/schema.ts`, `drizzle/migrations/`, `src/lib/google-groups.ts`, `src/app/members/page.tsx`, `src/components/members/`, `src/app/(dashboard)/admin/members/`, `src/components/admin/member-form.tsx`, `src/app/api/admin/members/`, `src/app/api/admin/membership-applications/[id]/route.ts`).

## Implementer split

**Specialist split: database-admin → api-developer → ux-developer.** This spans schema (new column + migration + backfill), four+ route handlers (`POST`/`PATCH` members, `PATCH` membership-applications with a new action branch, the google-groups query change), and three UI surfaces (member-form status control, admin list badge, directory badge). That's well past the full-stack-developer threshold (~150 lines, small + tightly coupled) — this is exactly the shape "every increment of The Ledger ran cleanly" through the specialist split. Suggested order:
1. **database-admin** — `membershipStatus` column in schema.ts + migration 0061 + backfill (and, if adopted, the CHECK constraint).
2. **api-developer** — the four write-path fixes above (conditional provisioning in create/edit, the new induction-provisioning branch, the approve-as-prospective branch, the sync-on-approve bug fix from decision #6), plus the `google-groups.ts` and directory-query filter changes. Also owns updating `scripts/import-roster.ts` / `sync-roster.ts` to set `membershipStatus` alongside `isActive`.
3. **ux-developer** — member-form 3-way control, admin list third badge state, directory "Prospective" badge component.

## Notes for Phase 3 (tech-lead must resolve, not re-litigate)

- Design the explicit induction-provisioning branch (see gap above) — this is the single highest-risk omission if it isn't named in the design doc.
- Decide whether the admin members list needs an explicit "Prospective" filter/tab (today's `status` query param supports `active`/inactive-ish views) — not required by any locked decision, but the admin who manages inductions will want to find all prospects at a glance; call it in-scope or explicitly defer it.
- Decide whether the CHECK constraint suggestion is worth taking given it's a new pattern for this migration set — fine either way, but say so explicitly so Phase 4 doesn't have to guess.
- Name the unit tests for the derived-boolean invariant and the three provisioning gates (create-as-prospective skips provisioning, edit-a-prospective-email skips provisioning, induct-to-active triggers provisioning) — these are exactly the kind of "quiet violation" a 30-day code review would otherwise have to catch after the fact.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're adding a third member lifecycle state, `membershipStatus` (`prospective | active | ended`), so people engaged with the club before formal induction (the Leonaida case) can ride the `club@westervillelions.org` email list without being counted as dues-liable, directory-listed, portal-eligible members. `isActive` keeps its exact current meaning ("counts as a real member") and becomes a value the server derives from `membershipStatus` on every write — never client input again. Two read surfaces (club@ sync, member directory) move onto an explicit `membershipStatus`-aware filter; six surfaces stay on `isActive` untouched. The two-thirds of this feature that are actually new risk are (a) a provisioning bug the locked decisions surfaced but no existing code path closes — the prospective→active induction transition must trigger `provisionUserForMember`, and today nothing does — and (b) a real pre-existing bug fix: application approval never fires `syncClubMembersList`. Both are fixed here. No new `FEATURES` key, no new page, no new table.

## Permissions

No new `FEATURES.*` key (confirmed, matches Phase 2 ruling). Existing gates, verified against the actual route files:

| Route | Gate (as it exists today, unchanged) |
|---|---|
| `GET /api/admin/members` | `FEATURES.MEMBERS_VIEW` |
| `POST /api/admin/members` | `FEATURES.MEMBERS_EDIT` |
| `PATCH /api/admin/members/[id]` | `FEATURES.MEMBERS_EDIT` |
| `DELETE /api/admin/members/[id]` | `FEATURES.MEMBERS_DELETE` |
| `PATCH /api/admin/membership-applications/[id]` (incl. new `approve_prospective` action) | `FEATURES.MEMBERSHIP_MANAGE` |
| `/admin/members` (page) | `FEATURES.MEMBERS_EDIT` (page-level `redirect` at line 30) |
| `/members` (directory) | authenticated-only, no feature gate — unchanged, consistent with every other member-portal page |

Every touched route already has its `auth()` + `hasFeature()` check in place; Phase 4 must not remove or weaken any of them.

## Data Model

**New column, no new table.**

`src/lib/db/schema.ts` — add directly below the existing `isActive` line (currently line 39) in the `members` table:

```ts
isActive: boolean("is_active").notNull().default(true),
membershipStatus: text("membership_status").notNull().default("active"), // 'prospective' | 'active' | 'ended'
```

`isActive` is **not removed, not renamed, not repurposed** — it stays a stored `boolean` column, exactly as the architect ruled. It is maintained as a derived value by application code, not by the database.

**The invariant:** `isActive === (membershipStatus === 'active')`. Every route that writes `members` computes `isActive` server-side from the submitted `membershipStatus`; no route accepts a client-submitted `isActive` value anymore (closes the exact hole the architect named: a form bug producing `status='prospective', isActive=true` would leak a prospect into dues billing).

**Migration `drizzle/migrations/0061_members_membership_status.sql`** (0060 is the current highest, confirmed via `ls drizzle/migrations`):

```sql
-- Prospective Members (docs/work-log/2026-07-26-prospective-members.md)
-- Adds a 3-state membership_status column. is_active remains a stored column;
-- it is maintained as a derived value (is_active = (membership_status = 'active'))
-- by every application write path — see isActiveForStatus() in src/lib/members.ts.
-- No DB-level CHECK constraint — see DECISION-041 in docs/decisions.md for why.

ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active';

-- Backfill: existing is_active=true rows are already correctly 'active' via the
-- column default. Existing is_active=false rows were "ended" under today's
-- semantics -- there is no historical signal that any of them were prospective.
UPDATE members SET membership_status = 'ended' WHERE is_active = false AND membership_status <> 'ended';
```

**CHECK constraint — explicitly declined, not just deferred.** The architect flagged this as an optional hardening step and noted no CHECK-constraint precedent existed in `drizzle/migrations/`. I looked further: this codebase has an *explicit, on-the-record decision against* DB-level CHECK constraints on status-like text columns — `src/lib/db/schema.ts` lines 935, 958, and 1018 each carry the comment `"No CHECK constraint on status — consistent with ledger_transactions.status pattern (inc1 precedent)"`. Adding one here would contradict a standing convention, not extend it. There's a second, sharper reason: this codebase's Drizzle schema has no first-class representation for CHECK constraints anywhere, and the invariant "`schema.ts` is the source of truth; anything in the live DB that isn't in `schema.ts` is dropped on the next `pnpm db:push`" makes an unrepresented constraint a risk to reason about on every future schema change, for a guarantee the application-level helpers (below) already provide and that `members.test.ts` regression-guards. Logged as **DECISION-041** in `docs/decisions.md`. If a future incident ever shows the application-level guard was insufficient, revisit then — don't pre-build for a failure mode with no observed instance in this codebase's history.

**`joinDate`** — no schema change (confirmed by architect: `createdAt` already answers "date added as prospect"). Behavior: set at the prospective/ended → active transition if still null; never touched otherwise. Detailed in API Contract below.

## API Contract

### `src/lib/members.ts` — new pure helpers (this is what makes the invariant and the provisioning gates unit-testable without a DB, matching this repo's existing test convention — see `src/lib/dues.test.ts`, `src/lib/ledger.test.ts`, both pure-function-only, no DB mocking anywhere in the test suite)

```ts
export type MembershipStatus = "prospective" | "active" | "ended";

/** The single source of truth for the isActive/membershipStatus invariant. */
export function isActiveForStatus(status: MembershipStatus): boolean {
  return status === "active";
}

/** POST /api/admin/members gate: provision only when creating an active member. */
export function shouldProvisionOnMemberCreate(status: MembershipStatus): boolean {
  return status === "active";
}

/**
 * PATCH /api/admin/members/[id] gate — unifies two previously-separate concerns
 * into one condition:
 *   (a) the pre-existing "defensive: email changed, no linked user" case, now
 *       correctly restricted to landing-as-active only (closes the bug where
 *       editing a prospect's email would silently provision them a login), and
 *   (b) the new induction case: status transitions to 'active' with no linked
 *       user, regardless of whether the email changed in the same request.
 * Never provisions on a transition INTO 'active' if a user is already linked
 * (re-affirm the link instead — provisionUserForMember already does that).
 */
export function shouldProvisionOnMemberUpdate(input: {
  previousStatus: MembershipStatus;
  newStatus: MembershipStatus;
  hasLinkedUser: boolean;
  emailChanged: boolean;
}): boolean {
  if (input.newStatus !== "active" || input.hasLinkedUser) return false;
  const becameActive = input.previousStatus !== "active" && input.newStatus === "active";
  return input.emailChanged || becameActive;
}

/**
 * joinDate rule (decision #8): set at transition-to-active if still null.
 * An explicit admin-submitted joinDate always wins. `now` is injectable for tests.
 */
export function resolveJoinDate(input: {
  becameActive: boolean;
  existingJoinDate: Date | null;
  submittedJoinDate: Date | null;
  now?: Date;
}): Date | null {
  if (input.submittedJoinDate) return input.submittedJoinDate;
  if (input.becameActive && !input.existingJoinDate) return input.now ?? new Date();
  return input.existingJoinDate;
}
```

### `src/lib/google-groups.ts`

```ts
export const CLUB_LIST_ELIGIBLE_STATUSES = ["active", "prospective"] as const;

/** club@ list eligibility (decision: prospects ride the list, ended members don't). */
export function isEligibleForClubList(status: MembershipStatus): boolean {
  return CLUB_LIST_ELIGIBLE_STATUSES.includes(status as typeof CLUB_LIST_ELIGIBLE_STATUSES[number]);
}
```

`syncClubMembersList()` (currently lines 141–144) changes from:
```ts
const activeMembers = await db.select({ email: members.email }).from(members)
  .where(and(eq(members.isActive, true)));
```
to:
```ts
const eligibleMembers = await db.select({ email: members.email }).from(members)
  .where(inArray(members.membershipStatus, CLUB_LIST_ELIGIBLE_STATUSES));
```
Explicit allow-list (`inArray`), not `ne(..., "ended")` — a future fourth status must be a deliberate code change to land on club@, per the architect's ruling.

### `POST /api/admin/members`

- **Request body:** drops `isActive`, adds `membershipStatus: "prospective" | "active" | "ended"` (default `"active"` if omitted, matching today's checkbox-defaulted-true behavior).
- **Behavior change:** `isActive: data.isActive ?? true` (current line 104) becomes `isActive: isActiveForStatus(membershipStatus)`. The `provisionUserForMember` call (currently unconditional, lines 108–127) becomes conditional on `shouldProvisionOnMemberCreate(membershipStatus)`. When skipped, `userLinked` is omitted from the response (no user was created or linked) — the response shape gains an implicit "prospects don't get a `userLinked` field" contract; UI must not assume it's present.
- **`joinDate`:** for a prospective create, stays `null` regardless of any `joinDate` value submitted from a stale form state (there's no "becameActive" transition on create, so `resolveJoinDate` isn't invoked here — creation is simpler: `joinDate: membershipStatus === "active" ? (data.joinDate ? new Date(data.joinDate) : new Date()) : null`). This preserves today's create-time behavior for full-member adds (an admin can still backdate a join date) while guaranteeing prospects never get one.
- **club@ sync:** unchanged — fires for every create regardless of status (a prospect must land on the list immediately).
- Response: unchanged `{ ...newMember, userLinked? }`, `newMember` now includes `membershipStatus`.

### `PATCH /api/admin/members/[id]`

- **Request body:** same `isActive` → `membershipStatus` swap as POST.
- Server computes `newIsActive = isActiveForStatus(data.membershipStatus)` (replaces line 64's `data.isActive ?? true`).
- **Transition detection:** `const becameActive = existing.membershipStatus !== "active" && data.membershipStatus === "active";` — this single boolean answers the architect's flagged gap (prospective→active AND ended→active both count; reactivating a former member gets the same treatment as inducting a new prospect, which is correct — no special-casing needed).
- **Unified provisioning block** replaces the current "defensive: if email changed and no linked user, provision" block (lines 102–125):
  ```ts
  const linkedUser = await db.query.users.findFirst({ where: eq(users.memberId, existing.id) });
  if (shouldProvisionOnMemberUpdate({
    previousStatus: existing.membershipStatus,
    newStatus: data.membershipStatus,
    hasLinkedUser: Boolean(linkedUser),
    emailChanged,
  })) {
    // same provisionUserForMember() call + EMAIL_CONFLICT handling as today
  }
  ```
  This one block now covers both the legacy email-changed case (correctly restricted to landing-as-active) and the new induction case (fires even with no email change).
- **`joinDate`:** `joinDate: resolveJoinDate({ becameActive, existingJoinDate: existing.joinDate, submittedJoinDate: data.joinDate ? new Date(data.joinDate) : null })`.
- **Existing `users.isActive` sync (lines 88–98) is untouched** — `activeChanged` already fires whenever computed `isActive` flips, in either direction. This is also how the active→prospective downgrade edge case (below) gets handled for free.
- club@ sync: unchanged, still fires on every update.

### `PATCH /api/admin/membership-applications/[id]`

- **Request body:** `action: "approve" | "approve_prospective" | "reject"` (was `"approve" | "reject"`).
- **New duplicate-email guard**, applied before either approve branch inserts a `members` row (today this route has *no* case-insensitive email-conflict check at all, unlike `POST /api/admin/members` — a real gap surfaced by asking "what happens on approve_prospective with a duplicate email"): reject with `409` if `lower(email)` already exists on another `members` row.
- **`approve`** (existing branch, bug fix applied): insert with `membershipStatus: "active"`, `isActive: true`, `joinDate: new Date()` (unchanged) → `provisionUserForMember` (unchanged) → **now also fires `syncClubMembersList({ triggerSource: "member_added", triggeredByUserId: session.user.id }).catch(...)`, fire-and-forget, matching the pattern in `POST /api/admin/members`**. This is the named bug fix — today this call is simply missing.
- **`approve_prospective`** (new branch): insert with `membershipStatus: "prospective"`, `isActive: false`, `joinDate: null` → **does not call `provisionUserForMember`** → fires the same fire-and-forget `syncClubMembersList(...)`.
- **`reject`**: unchanged.
- `membershipApplications.status` stays `"approved"` for both `approve` and `approve_prospective` — there's no third value on the application's own status column. Whether a given approval landed the person as active or prospective is answered by looking at the created `members` row's `membershipStatus` (matched by email), not by the application record. This is an explicit design call, not an oversight — no schema change to `membershipApplications` is in scope.

## Component / Page Plan

No new pages. Files to modify:

- **`src/components/admin/member-form.tsx`** — `MemberFormData.isActive: boolean` → `MemberFormData.membershipStatus: "prospective" | "active" | "ended"`. Replace the checkbox (lines 433–448) with a `<select id="membershipStatus" name="membershipStatus">` (Prospective / Active / Ended), defaulting to `"active"` for new-member state (line 69), matching today's checked-by-default behavior. `handleChange`'s existing generic branch (`value || null`) already handles a `<select>` correctly — no special-casing needed since all three option values are non-empty strings. The "Membership Ended" date field (lines 267–282) stays in the form unconditionally (preserves existing records with a set date), but ux-developer should visually de-emphasize it (e.g., `disabled`/greyed) when `membershipStatus !== "ended"` — a UX nicety, not a hard requirement, and not worth a `<ConfirmDialog>` since it's a plain field inside the existing Save flow, not a new destructive action.
- **`src/components/admin/application-action-buttons.tsx`** — add a third button, "Approve as Prospective," calling `handleAction("approve_prospective")`. `handleAction`'s type widens to `"approve" | "approve_prospective" | "reject"`; success toast branches on the action for accurate copy (e.g., "Application approved as prospective — added to club email list.").
- **`src/app/(dashboard)/admin/members/page.tsx`** —
  - Status pill (lines 296–306): third visual state. Active → unchanged (`bg-green-100 text-green-800`). Prospective → `bg-lions-gold/20 text-lions-blue-dark` (gold accent per UX guidelines, not a card border — this is a `rounded-full` pill, the correct existing convention for status badges on this page). Ended → unchanged from today's "Inactive" styling (`bg-gray-100 text-gray-500`), just relabeled "Ended."
  - Status filter branch (lines 60–64): add `else if (status === "prospective") conditions.push(eq(members.membershipStatus, "prospective"))` and the equivalent for `"ended"`. The existing `"active"`/`"inactive"` branches (isActive-keyed) are untouched — zero behavior change for any bookmarked/linked URL using today's filter.
- **`src/components/admin/member-search.tsx`** — add two new `<option>`s to the status `<select>` (lines 141–143): `value="prospective"` label "Prospective only" and `value="ended"` label "Ended only". Relabel the existing `value="inactive"` option from "Inactive only" to "Prospective + Ended" for clarity (value/behavior unchanged — this keeps every existing `?status=inactive` link working exactly as today).
- **`src/app/members/page.tsx`** — line 17's `where: eq(members.isActive, true)` → `where: inArray(members.membershipStatus, ["active", "prospective"])` (import `inArray` from `drizzle-orm`, already imported for other queries in this file's sibling admin page). `membersWithTags` mapping (lines 69–80) gains `membershipStatus: member.membershipStatus`.
- **`src/components/members/member-directory.tsx`** — `Member` interface (lines 13–24) gains `membershipStatus: "prospective" | "active" | "ended"`. In the member card's tag row (next to `groupTags`/`branch`/`serviceBadge`, lines 241–262), render a "Prospective" pill when `member.membershipStatus === "prospective"`: `bg-lions-gold/20 text-lions-blue-dark text-xs font-semibold rounded-full px-2 py-1 whitespace-nowrap` — same pill shape as every other tag already on this card, gold as an accent per the brand guidelines, no `lions-red`. Active members render no extra badge (unchanged today).
- **`scripts/import-roster.ts`** (line 118) and **`scripts/sync-roster.ts`** (lines 49, 90, 105, 125) — both currently write `isActive` with no `membershipStatus`, which after this migration would default every imported row to `membershipStatus = 'active'` regardless of the computed `isActive` value, violating the invariant for any `isActive: false` row (Ended member imported via roster sync would incorrectly read `membershipStatus: 'active'` and re-appear on club@). Fix: both scripts compute `const membershipStatus: MembershipStatus = isActive ? "active" : "ended";` (import roster has no signal for "prospective" — mirrors the migration's own backfill rule) and pass it alongside `isActive` on every insert/update.

## Implementation Order

1. **database-admin** — `membershipStatus` column in `schema.ts` (below existing `isActive` field) + migration `0061_members_membership_status.sql` (add column, backfill, no CHECK constraint per DECISION-041). Run `pnpm db:migrate` locally and confirm the backfill: every row where `is_active = false` reads `membership_status = 'ended'` after the migration, every other row reads `'active'` (manual spot-check via `psql`/Drizzle Studio — this codebase has no DB-integration test harness, so this is a manual verification step, not a Vitest test; note it in the Phase 4 work-log).
2. **api-developer** —
   a. `src/lib/members.ts` — add `MembershipStatus`, `isActiveForStatus`, `shouldProvisionOnMemberCreate`, `shouldProvisionOnMemberUpdate`, `resolveJoinDate`; write `src/lib/members.test.ts` (see Unit Tests below).
   b. `src/lib/google-groups.ts` — add `isEligibleForClubList`/`CLUB_LIST_ELIGIBLE_STATUSES`, update `syncClubMembersList`'s query; write `src/lib/google-groups.test.ts`.
   c. `POST /api/admin/members`, `PATCH /api/admin/members/[id]` — wire the new helpers in per the API Contract above.
   d. `PATCH /api/admin/membership-applications/[id]` — third action, duplicate-email guard, sync-on-approve fix, sync-on-approve_prospective.
   e. `scripts/import-roster.ts`, `scripts/sync-roster.ts` — `membershipStatus` mapping fix.
3. **ux-developer** — `member-form.tsx` status `<select>`, `application-action-buttons.tsx` third button, `admin/members/page.tsx` badge + filter branch, `member-search.tsx` new options, `app/members/page.tsx` query, `member-directory.tsx` badge.
4. No email notification changes — induction reuses the existing `provisionUserForMember` → `sendWelcomeEmail` → `sendEmail()` path unchanged; no new template.
5. Release notes — tech-lead, after Phase 6 SHIP IT.

## Edge Cases & Risks

- **Active → Prospective downgrade — decided: no special handling needed.** The existing `activeChanged` block in `PATCH /api/admin/members/[id]` (lines 88–98, untouched) already flips the linked `users.isActive` to `false` any time computed `isActive` transitions `true → false` — which now happens for both `→ ended` and `→ prospective`. Their portal login is locked out immediately, matching "prospects get no portal access." Their `users` row and `memberId` link are preserved (not deleted), so a later re-induction re-activates the same account rather than orphaning it. No new code needed here — this is the payoff of keeping `isActive` derived instead of introducing a parallel gate.
- **Prospect email already tied to an existing `users` row.** Because prospective creates skip `provisionUserForMember` entirely (`shouldProvisionOnMemberCreate` returns `false`), the `users` table is never touched for a prospective create — no `EMAIL_CONFLICT` path exists to worry about. The pre-existing case-insensitive `members.email` uniqueness check (unconditional, unchanged) still prevents two `members` rows sharing an email.
- **Ended → Active reactivation.** Handled by the same `becameActive` condition as prospective → active — no separate branch. `resolveJoinDate` correctly leaves an already-set `joinDate` untouched (a returning member keeps their original tenure date) while still stamping `joinDate` for a never-set one.
- **`syncClubMembersList` fire-and-forget failure visibility.** Unchanged and explicitly out of scope for this feature (confirmed, matches the Phase 1 analyst's framing) — a failed Google API call is still silent to the admin beyond `google_group_sync_log`. Pre-existing gap, not introduced or worsened here.
- **Duplicate email on `approve_prospective`.** Closed by the new case-insensitive guard added to the applications route (see API Contract) — applies to both `approve` and `approve_prospective`, since the risk existed for `approve` too and was never checked.
- **Stale `userLinked` assumption in the admin UI.** Any code reading `response.userLinked` after a `POST /api/admin/members` call must handle it being `undefined` for a prospective create — grep for `userLinked` usage during Phase 4 to confirm nothing assumes it's always present.
- **`scripts/import-roster.ts` / `sync-roster.ts` drift** — flagged above; if skipped, the next roster import silently mislabels every "not active" roster row as `membershipStatus: 'active'`, which would leak ended members back onto club@ on the next sync. This must ship in the same PR as the migration, not deferred.

## Unit Tests (implementer delivers these in Phase 4, per this repo's pure-function test convention — no DB mocking anywhere in the existing suite)

**`src/lib/members.test.ts`** (new file):
- `describe("isActiveForStatus")` — `"active"` → `true`; `"prospective"` → `false`; `"ended"` → `false`.
- `describe("shouldProvisionOnMemberCreate")` — `"active"` → `true`; `"prospective"` → `false`; `"ended"` → `false`.
- `describe("shouldProvisionOnMemberUpdate")`:
  - prospective → active, no linked user → `true` (the induction gap the architect flagged).
  - active, email changed, no linked user → `true` (legacy defensive path, preserved).
  - active, email changed, has linked user → `false` (already provisioned; re-affirm link only).
  - **prospective, email changed, no linked user → `false`** (the exact bug being fixed: editing a prospect's email must not silently provision them a login).
  - active → ended, no linked user → `false` (never provision on a downgrade).
  - active → active (no status change, no email change) → `false` (no-op).
  - ended → active, no linked user → `true` (reactivation gets the same treatment as induction).
- `describe("resolveJoinDate")`:
  - `becameActive: true`, `existingJoinDate: null`, `submittedJoinDate: null` → returns `now`.
  - `becameActive: true`, `existingJoinDate: null`, `submittedJoinDate: <date>` → returns the submitted date (admin override wins).
  - `becameActive: true`, `existingJoinDate: <date>`, `submittedJoinDate: null` → returns the existing date (never overwritten).
  - `becameActive: false` → returns `submittedJoinDate ?? existingJoinDate` (unchanged behavior for non-transition edits).

**`src/lib/google-groups.test.ts`** (new file):
- `describe("isEligibleForClubList")` — `"active"` → `true`; `"prospective"` → `true`; `"ended"` → `false`.

**Not covered by Vitest, covered by manual verification instead (name explicitly so QA doesn't assume a missing test file is a gap):**
- Migration backfill correctness (`membership_status` matches `is_active` post-migration) — no DB-integration test harness exists in this repo; database-admin verifies via a manual query against the dev DB after running `pnpm db:migrate`, and records the result in the Phase 4 work-log entry.
- `approve_prospective` end-to-end (insert + no-provision + sync-fires) and the duplicate-email 409 on the applications route — no route-handler test precedent exists in this codebase (grep confirms zero `route.test.ts` files); qa covers this via the Phase 5 manual click-through, not a new Vitest pattern introduced here.

## Implementer

**Specialist split: database-admin → api-developer → ux-developer**, per the Phase 2 ruling (schema + 3+ route handlers + 3 UI surfaces is well past the full-stack-developer ~150-line threshold).

---

# Phase 4 — Implementation (schema) — 2026-07-26

**Owner:** database-admin
**Status:** complete

### Summary

Added `members.membershipStatus` (`prospective | active | ended`, `text`, `NOT NULL DEFAULT 'active'`) directly below the existing `isActive` column in `src/lib/db/schema.ts`, per the Phase 3 design's exact column definition. `isActive` is untouched — still a stored boolean, still defaults to `true` — and remains the application's job to keep derived (`isActiveForStatus()`, api-developer's next step). Migration `0061_members_membership_status.sql` adds the column idempotently and backfills existing `is_active = false` rows to `'ended'`. No CHECK constraint, per DECISION-041.

### What I did

- Added `membershipStatus: text("membership_status").notNull().default("active")` to the `members` table in `src/lib/db/schema.ts`, immediately after the existing `isActive` line, with an inline comment pointing to `isActiveForStatus()` (api-developer's upcoming helper in `src/lib/members.ts`) and to DECISION-041 for the no-CHECK-constraint rationale.
- Confirmed `0060_ledger_receipt_files.sql` is the current highest migration (`ls drizzle/migrations/*.sql | sort | tail`), so `0061` is correct and uncollided.
- Wrote `drizzle/migrations/0061_members_membership_status.sql`:
  - `ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active';`
  - Backfill: `UPDATE members SET membership_status = 'ended' WHERE is_active = false AND membership_status <> 'ended';` — idempotent (no-op on re-run once every `is_active=false` row already reads `'ended'`).
  - No CHECK constraint, matching DECISION-041 and the `ledger_transactions.status` / `ledger_reimbursements.status` / `ledger_filings.status` precedent already in `schema.ts`.
- Did not touch application logic, routes, `src/lib/members.ts`, `src/lib/google-groups.ts`, roster scripts, or any UI — those are api-developer's and ux-developer's steps per the Phase 3 implementation order.
- Ran `pnpm install` (node_modules was absent in this environment) then `pnpm exec tsc --noEmit` — **PASS, zero errors**.
- Did **not** run `pnpm db:migrate` or `pnpm db:push` against any live database, per instructions — that's deferred to whoever next has `.env.local` access and should be done before/alongside api-developer's work. The Phase 3 design's manual backfill spot-check ("every row where `is_active = false` reads `membership_status = 'ended'` after migration") is still an open verification step against the real dev DB.

### Outputs

- `src/lib/db/schema.ts` — `members` table, new `membershipStatus` column (see diff: line ~39-43, right after `isActive`).
- `drizzle/migrations/0061_members_membership_status.sql` — new file, two idempotent statements (`ADD COLUMN IF NOT EXISTS` + guarded `UPDATE` backfill), no CHECK constraint (DECISION-041).
- Tables affected: `members` only.
- No role bindings or feature-key seed rows — this feature introduces no new `FEATURES.*` key (confirmed by architect and tech-lead).
- Local apply command (not run by me): `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`, then `pnpm db:push` (schema.ts also changed).

### Open questions / handoff notes

- **New column available to api-developer:** `members.membershipStatus: string` (`"prospective" | "active" | "ended"` at the app layer, `text` in the DB, default `"active"`). `members.isActive` unchanged in shape — still `boolean`, still `notNull().default(true)` — but its *meaning going forward* is "derived from `membershipStatus`," which api-developer's helpers (`isActiveForStatus`, `shouldProvisionOnMemberCreate`, `shouldProvisionOnMemberUpdate`, `resolveJoinDate` in `src/lib/members.ts`) must enforce on every write path — no route should accept a client-submitted `isActive` anymore.
- Foreign keys/relationships: none new — this is a plain column add on an existing table, no new FK.
- **Next agent: api-developer**, per Phase 3's implementation order: build `src/lib/members.ts` helpers + `src/lib/members.test.ts`, update `src/lib/google-groups.ts` (`isEligibleForClubList` + `syncClubMembersList` query change) + `src/lib/google-groups.test.ts`, wire `POST`/`PATCH /api/admin/members`, add the `approve_prospective` branch to `PATCH /api/admin/membership-applications/[id]`, and fix `scripts/import-roster.ts` / `scripts/sync-roster.ts` to set `membershipStatus` alongside `isActive` (flagged by both architect and tech-lead as a real drift risk if skipped).
- **Before api-developer's work lands in a real environment**, someone with `.env.local` access should run `pnpm db:migrate` (or `pnpm dev`, which replays migrations on startup) and spot-check the backfill: every pre-existing `is_active = false` row should now read `membership_status = 'ended'`, everything else `'active'`. I did not have/use a live `DATABASE_URL` in this session, so this manual verification step (called out explicitly in the Phase 3 design) is still outstanding.

---

# Phase 4 — Implementation (server) — 2026-07-26

**Owner:** api-developer
**Status:** complete

### Summary

Built exactly to the Phase 3 API contract: added the four pure helpers (`isActiveForStatus`, `shouldProvisionOnMemberCreate`, `shouldProvisionOnMemberUpdate`, `resolveJoinDate`) to `src/lib/members.ts`; added `isEligibleForClubList`/`CLUB_LIST_ELIGIBLE_STATUSES` to `src/lib/google-groups.ts` and switched `syncClubMembersList()`'s query from `isActive = true` to the explicit allow-list; wired `membershipStatus` (server-derives `isActive`, never trusts client input) into `POST`/`PATCH /api/admin/members`; added the `approve_prospective` action plus the `approve`-branch `syncClubMembersList` bug fix and a new duplicate-email guard to `PATCH /api/admin/membership-applications/[id]`; and updated both roster scripts to keep `membershipStatus` in sync with `isActive`. All named unit tests are written and passing.

### What I did

- `src/lib/members.ts` — added `MembershipStatus` type and the four pure helpers verbatim per the Phase 3 design (no DB calls). No changes to `provisionUserForMember`.
- `src/lib/members.test.ts` (new) — 17 tests: `isActiveForStatus` (3 cases), `shouldProvisionOnMemberCreate` (3 cases), `shouldProvisionOnMemberUpdate` (7 cases, including the induction gap, the prospect-email-change non-bug, and the ended→active reactivation case), `resolveJoinDate` (4 cases). Mocks `@/lib/db` (same pattern as `permissions-server.test.ts`) since `members.ts` transitively imports it via `provisionUserForMember`'s dependencies.
- `src/lib/google-groups.ts` — added `CLUB_LIST_ELIGIBLE_STATUSES` (`["active", "prospective"]`) and `isEligibleForClubList()`; changed `syncClubMembersList()`'s query from `and(eq(members.isActive, true))` to `inArray(members.membershipStatus, CLUB_LIST_ELIGIBLE_STATUSES)` (explicit allow-list, not a negation, per the architect's ruling). `syncGoogleGroup()` (per-committee sync) is untouched — confirmed out of scope per the Phase 1 analyst's note.
- `src/lib/google-groups.test.ts` (new) — 4 tests: `isEligibleForClubList` for `active`/`prospective`/`ended`, plus a sanity check that the allow-list is exactly `["active", "prospective"]`. Mocks `@/lib/db`.
- `POST /api/admin/members` — accepts `membershipStatus` (validated against the 3 allowed values, defaults to `"active"` if omitted/invalid, matching today's checkbox-defaulted-true behavior); `isActive` is now always `isActiveForStatus(membershipStatus)`, never client-trusted; `provisionUserForMember` gated by `shouldProvisionOnMemberCreate`; `joinDate` set per the design's exact formula (prospects get `null`, active creates get submitted-or-now); response omits `userLinked` entirely for a skipped-provisioning create (was previously always present).
- `PATCH /api/admin/members/[id]` — same `membershipStatus`→`isActive` derivation (falls back to the existing status if the client omits/sends an invalid value, rather than silently defaulting to `"active"` — a deliberate deviation from POST's default, since an edit without an explicit status change shouldn't reactivate someone); replaced the old "email changed + no linked user" defensive block with the unified `shouldProvisionOnMemberUpdate` gate (now covers induction and reactivation, and correctly *skips* provisioning a prospect whose email changes); `joinDate` now runs through `resolveJoinDate`; the existing `users.isActive` sync block (`activeChanged`) is untouched, so active→prospective/ended still locks portal login for free.
- `PATCH /api/admin/membership-applications/[id]` — `action` now accepts `"approve" | "approve_prospective" | "reject"` (400 on anything else); added a case-insensitive duplicate-email guard (409) before either approve branch — this route previously had none at all; `approve` now also fires `syncClubMembersList` (the named bug fix — it was simply missing before); new `approve_prospective` branch inserts `membershipStatus: "prospective"`, `isActive: false`, `joinDate: null`, does **not** call `provisionUserForMember`, and fires the same fire-and-forget sync.
- `scripts/import-roster.ts` (line ~118) and `scripts/sync-roster.ts` (4 call sites) — both now compute `membershipStatus` (`"active"` or `"ended"` — no prospective signal exists in either roster source, matching the migration's own backfill rule) and pass it alongside `isActive` on every insert/update, closing the drift risk both the architect and tech-lead flagged.
- Did not touch: `src/app/members/page.tsx` (directory query), `member-form.tsx`, `application-action-buttons.tsx`, `admin/members/page.tsx` (badge/filter), `member-search.tsx`, `member-directory.tsx` — all explicitly ux-developer's step per the Phase 3 implementation order.

### Outputs

**Files changed:**
- `src/lib/members.ts` — added `MembershipStatus`, `isActiveForStatus`, `shouldProvisionOnMemberCreate`, `shouldProvisionOnMemberUpdate`, `resolveJoinDate`.
- `src/lib/members.test.ts` — new, 17 tests.
- `src/lib/google-groups.ts` — added `CLUB_LIST_ELIGIBLE_STATUSES`, `isEligibleForClubList`; changed `syncClubMembersList()` query.
- `src/lib/google-groups.test.ts` — new, 4 tests.
- `src/app/api/admin/members/route.ts` — `POST` handler.
- `src/app/api/admin/members/[id]/route.ts` — `PATCH` handler.
- `src/app/api/admin/membership-applications/[id]/route.ts` — `PATCH` handler, new `approve_prospective` action, sync-on-approve fix, duplicate-email guard.
- `scripts/import-roster.ts`, `scripts/sync-roster.ts` — `membershipStatus` mapping added alongside `isActive`.

**API contracts for the next agent:**

| Route / function | Auth + gate | Request | Response |
|---|---|---|---|
| `POST /api/admin/members` | `auth()` + `FEATURES.MEMBERS_EDIT` | Body drops `isActive`, adds `membershipStatus?: "prospective" \| "active" \| "ended"` (default `"active"`) | `201 { ...member, userLinked?: "created" \| "existing" }` — `userLinked` is **absent** (not `undefined` in a visible sense, but omitted from the JSON) when the create was prospective. UI must not assume it's always present. |
| `PATCH /api/admin/members/[id]` | `auth()` + `FEATURES.MEMBERS_EDIT` | Body drops `isActive`, adds `membershipStatus?: "prospective" \| "active" \| "ended"` (falls back to the existing status if omitted/invalid — no default-to-active) | `200 <updated member>`, now includes `membershipStatus` |
| `PATCH /api/admin/membership-applications/[id]` | `auth()` + `FEATURES.MEMBERSHIP_MANAGE` | `{ action: "approve" \| "approve_prospective" \| "reject", adminNotes? }` | `200 { success: true }` on success; `400` invalid action; `404` application not found; `409` duplicate email (new — applies to both approve branches) |
| `isActiveForStatus`, `shouldProvisionOnMemberCreate`, `shouldProvisionOnMemberUpdate`, `resolveJoinDate` | n/a (pure) | see `src/lib/members.ts` | — |
| `isEligibleForClubList`, `CLUB_LIST_ELIGIBLE_STATUSES` | n/a (pure) | see `src/lib/google-groups.ts` | — |

- Schema changes: none — `membershipStatus` column already landed in Phase 4 (schema). No new migration.
- No new `FEATURES.*` key (confirmed, matches Phase 2/3 rulings).

### Test results

- `pnpm exec tsc --noEmit` — **PASS**, zero errors.
- `pnpm test` — **PASS**, 480/480 tests across 17 files (17 new in `members.test.ts` + 4 new in `google-groups.test.ts` = 21 new; 459 pre-existing, all still green).
- `pnpm lint` — **could not run**: this sandbox's ESLint install is broken independent of this change (`ESLint: 9.39.2` crashes at startup with `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`, inside `@eslint/eslintrc`'s `override-tester.js` — a pnpm/ESM interop issue in `node_modules`, not a lint finding). Flagging for deployment-engineer/qa to confirm in an environment with a working `node_modules`; not something this change caused or can fix from application code.
- `pnpm build:only` — **partially verified**: Turbopack compiled successfully and `next build`'s own internal TypeScript pass ("Finished TypeScript") succeeded with no errors. The build then failed at the "Collecting page data" step with `Error: DATABASE_URL or DB_URL environment variable is not set` — this sandbox has no `.env.local` / live `DATABASE_URL`, a pre-existing environment limitation (confirmed via `env | grep DATABASE_URL` returning nothing) affecting every route that touches `@/lib/db` at page-data-collection time, not specific to this feature. Compilation + typecheck stages passing is the strongest signal available in this sandbox that the change is build-clean; qa/deployment-engineer should re-run the full `pnpm build:only` against a real `DATABASE_URL` before ship.

### Deviations from the design

- None functionally. One clarified interpretation: the design's PATCH contract doesn't explicitly state what happens if `membershipStatus` is omitted or invalid on an edit. I chose "fall back to the existing status" rather than "default to active" (which is POST's rule) — defaulting an edit-without-a-status-field to `"active"` would silently reactivate an ended/prospective member on any edit that forgets to include the field, which is a worse failure mode than a no-op. Flagging explicitly since it's not spelled out verbatim in the Phase 3 doc.

### Open questions / handoff notes

- **Next agent: ux-developer**, per the Phase 3 implementation order (step 3). Needs to build:
  - `src/components/admin/member-form.tsx` — replace the "Active Member" checkbox with a 3-option `membershipStatus` control; stop submitting `isActive`.
  - `src/components/admin/application-action-buttons.tsx` — third button for `approve_prospective`.
  - `src/app/(dashboard)/admin/members/page.tsx` — third badge state + filter branch for `prospective`/`ended`.
  - `src/components/admin/member-search.tsx` — new filter `<option>`s.
  - `src/app/members/page.tsx` — directory query switches to `inArray(members.membershipStatus, ["active", "prospective"])` (import `inArray`); `membersWithTags` gains `membershipStatus`.
  - `src/components/members/member-directory.tsx` — `Member` interface gains `membershipStatus`; render a "Prospective" pill.
- **Response-shape gotcha for the UI to grep for:** any existing code reading `response.userLinked` after `POST /api/admin/members` must handle it being absent for a prospective create (Phase 3's own flagged risk — I did not find any current UI usage during this pass, but ux-developer should re-grep once building the form).
- **`pnpm lint` and full `pnpm build:only` verification are still outstanding** in a working environment — see Test results above. Not a code defect from this change; flagging so qa doesn't assume these were skipped for a bad reason.
- **Manual backfill spot-check** (every pre-existing `is_active = false` row now reads `membership_status = 'ended'`) is still outstanding per database-admin's Phase 4 note — nobody in this pipeline has yet run `pnpm db:migrate` against a live DB.
- Confirmed no `console.log` added in any production path (only pre-existing `console.error`/`console.warn` patterns reused, consistent with the rest of `google-groups.ts` and the members routes).
- Confirmed no native browser dialogs touched (server-only work).

---

# Phase 4 — Implementation (UI) — 2026-07-26

**Owner:** ux-developer
**Status:** complete

### Summary

Built exactly to the Phase 3 component plan, consuming the API contract api-developer left in the work-log (`membershipStatus` on `POST`/`PATCH /api/admin/members`, `approve_prospective` action on the applications route, no client-submitted `isActive` anywhere). Replaced the admin member-form's "Active Member" checkbox with a 3-option `membershipStatus` select; added a third "Approve as Prospective" button to the application action buttons; added a third status-pill state and two additive filter options to the admin members list; and switched the member directory query to include prospects, rendering a gold "Prospective" badge on their card. `typecheck` and the full Vitest suite (480/480) stay green.

### What I did

- **`src/components/admin/member-form.tsx`** — exported a local `MembershipStatus` type (mirrors `src/lib/members.ts`'s exported type — the form doesn't import server-side `src/lib/members.ts` to keep the client bundle free of server-only dependencies, consistent with this file's existing self-contained style); `MemberFormData.isActive: boolean` → `MemberFormData.membershipStatus: MembershipStatus`. Replaced the checkbox (old lines 433-448) with a `<select id="membershipStatus" name="membershipStatus" required>` with options Prospective / Active / Ended, defaulting new-member state to `"active"` (preserves today's checked-by-default behavior). The form no longer submits `isActive` at all — the API derives it server-side per the contract. De-emphasized the "Membership Ended" date field (`disabled` + greyed label/helper text) when `membershipStatus !== "ended"`, per the design's "UX nicety, not a hard requirement" — since the field is a controlled React input (not native form serialization), `disabled` only blocks interaction; the existing value still round-trips in `formData` state and submits unchanged, so pre-existing `membershipEndedDate` values on records are preserved exactly as the design required.
- **`src/app/(dashboard)/admin/members/[id]/page.tsx`** — edit-page `formData` mapping now passes `membershipStatus: member.membershipStatus as MemberFormData["membershipStatus"]` instead of `isActive: member.isActive` (schema types the column as plain `text`, so a narrowing cast is needed, same pattern used elsewhere in this codebase for text-enum columns).
- **`src/components/admin/application-action-buttons.tsx`** — `handleAction`'s type widened to `"approve" | "approve_prospective" | "reject"`; added a third button "Approve as Prospective" using the secondary-outlined style (`border-2 border-lions-blue text-lions-blue ... hover:bg-lions-blue/5`) so it reads as a distinct-but-non-destructive option alongside the existing green "Approve" and red-bordered "Reject" buttons; added a `title` tooltip clarifying it skips portal provisioning; success toast branches on the action for accurate copy ("Application approved as prospective — added to club email list."). Did **not** add a `<ConfirmDialog>` — the existing Approve button has no confirmation step today (direct click), so Approve as Prospective matches that pattern exactly; only Reject has an inline notes/confirm panel, which is unchanged. Also added `focus:ring-2 focus:ring-lions-blue` to all three buttons for consistent focus visibility (the original Approve/Reject buttons were missing this — a small drive-by accessibility fix, in-scope since I was already editing this block's className).
- **`src/app/(dashboard)/admin/members/page.tsx`** — status filter branch gained `else if (status === "prospective")` / `else if (status === "ended")` clauses keyed on `members.membershipStatus`, additive to the untouched `active`/`inactive` (`isActive`-keyed) branches — no existing bookmarked `?status=` link changes behavior. Status pill now keys off `member.membershipStatus` (three states: Active green, Prospective `bg-lions-gold/20 text-lions-blue-dark`, Ended grey/"Ended" label) instead of the old binary `member.isActive` Active/Inactive pill — kept the existing `rounded-full` pill convention unchanged.
- **`src/components/admin/member-search.tsx`** — added two `<option>`s to the status select: `value="prospective"` ("Prospective only") and `value="ended"` ("Ended only"); relabeled the existing `value="inactive"` option to "Prospective + Ended" per the design (value/behavior unchanged, so `?status=inactive` links keep working).
- **`src/app/members/page.tsx`** — directory query switched from `where: eq(members.isActive, true)` to `where: inArray(members.membershipStatus, ["active", "prospective"])` (`inArray` was already imported in this file); `membersWithTags` mapping gains `membershipStatus: member.membershipStatus as "active" | "prospective" | "ended"`. Stayed a Server Component — no interactivity added.
- **`src/components/members/member-directory.tsx`** — `Member` interface gains `membershipStatus: "active" | "prospective" | "ended"`; renders a `bg-lions-gold/20 text-lions-blue-dark` "Prospective" pill in the card's tag row (same `rounded-full` pill shape as the existing group/branch/service-years tags) when `member.membershipStatus === "prospective"`. Active members get no extra badge, matching today's behavior. Stayed a client component only because it already was one (existing search/filter state) — no new client boundary introduced by this change.
- Grepped for `response.userLinked` usage in UI code per api-developer's flagged risk — confirmed zero references; `member-form.tsx` doesn't read the create/update response body beyond checking `response.ok`, so the "absent for prospective creates" response-shape change is a non-issue for this UI.
- Did not touch server routes, `src/lib/members.ts`, `src/lib/google-groups.ts`, schema, migrations, or any test file — UI only, per scope.

### Outputs

- `src/components/admin/member-form.tsx` — status `<select>` replacing the "Active Member" checkbox; de-emphasized "Membership Ended" date field.
- `src/app/(dashboard)/admin/members/[id]/page.tsx` — `formData` mapping passes `membershipStatus` instead of `isActive`.
- `src/components/admin/application-action-buttons.tsx` — third "Approve as Prospective" button; widened action type; focus-ring accessibility fix on all three buttons.
- `src/app/(dashboard)/admin/members/page.tsx` — `prospective`/`ended` filter branches; 3-state status pill.
- `src/components/admin/member-search.tsx` — two new filter `<option>`s; relabeled "inactive" option.
- `src/app/members/page.tsx` — directory query now includes prospects (`inArray`); `membersWithTags` carries `membershipStatus`.
- `src/components/members/member-directory.tsx` — `Member` interface gains `membershipStatus`; renders gold "Prospective" pill.
- No decisions requiring a new `docs/decisions.md` entry — all choices here were either spelled out verbatim in the Phase 3 design or clearly-scoped UX niceties (disabled date field styling, focus-ring fix) within the existing conventions.

### UX gate checklist

- Cards: no new card containers introduced; existing `rounded-2xl`/`rounded-xl` containers on these pages were untouched (out of scope for this feature).
- Buttons: new "Approve as Prospective" button is `rounded-lg`, uses the documented secondary-outlined style (`border-2 border-lions-blue text-lions-blue ... hover:bg-lions-blue/5`). No `rounded-full` buttons introduced.
- Badges/pills: both new "Prospective" badges (admin list pill, directory card tag) use `bg-lions-gold/20 text-lions-blue-dark`, matching the Phase 3 design's exact class string and the existing `rounded-full` pill convention on both surfaces. No `lions-red` anywhere.
- No native browser dialogs added or touched — Approve/Approve-as-Prospective/Reject all follow the pre-existing pattern (direct click / inline notes panel), no `<ConfirmDialog>` needed since neither original flow used one.
- Mobile-first: the three application-action buttons now wrap `flex-col` on mobile (`sm:flex-row`) since a third button made the previous fixed `flex` row too cramped below `sm` — verified this doesn't regress the two-button case (reject-confirm sub-view is unaffected, still 2 buttons in `flex`).
- Focus rings: `focus:outline-none focus:ring-2 focus:ring-lions-blue` present on all three action buttons (added to Approve/Reject as a drive-by fix, was already correctly present on other touched controls).
- Server/client boundary: `src/app/members/page.tsx` and `src/app/(dashboard)/admin/members/page.tsx` remain Server Components — only the query/rendering logic changed, no new `'use client'`. `member-form.tsx` and `application-action-buttons.tsx` were already client components; no new client boundary crossed.

### Test results

- `pnpm exec tsc --noEmit` — **PASS**, zero errors.
- `pnpm test` — **PASS**, 480/480 tests across 17 files, unchanged from api-developer's Phase 4 baseline (no test files touched in this step, none should have regressed).
- `pnpm build:only` — not run; this sandbox has no live `DATABASE_URL`/`.env.local` (same pre-existing limitation api-developer flagged — the build fails at "Collecting page data" independent of this change). Deferred to qa/deployment-engineer per api-developer's note.
- `pnpm lint` — not re-attempted; api-developer already flagged this sandbox's ESLint install as broken independent of any code change (`minimatch`/ESM interop crash in `node_modules`).

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Suggested manual click-through:
  1. `/admin/members/new` — confirm the status select defaults to "Active", switching it to "Prospective" doesn't touch/require the Membership Ended date, and the field visibly greys out and disables when status ≠ "Ended".
  2. `/admin/members/[id]` (edit an existing member) — confirm the select is pre-populated with the member's current `membershipStatus`, not defaulted to "Active"; set to "Ended" and confirm the date field re-enables.
  3. `/admin/membership` — click "Approve as Prospective" on a pending application, confirm the toast copy, confirm the created member row shows the gold "Prospective" pill at `/admin/members` and does **not** appear counted in dues/active-member surfaces (per api-developer's server contract — this is a cross-check, not new UI logic).
  4. `/admin/members` — cycle through the status filter dropdown (Active only / Prospective + Ended / Prospective only / Ended only / All members) and confirm each returns the expected rows; confirm bookmarked `?status=inactive` links still work unchanged.
  5. `/members` (the member portal directory, as a linked member account) — confirm a prospective member now appears with a gold "Prospective" pill next to their name, and an ended member does not appear at all.
  6. Mobile viewport (360px) — `/admin/membership`'s three-button row should stack vertically; the member-form status select and admin members table should remain usable.
- **New copy strings the Lions Club may want to refine:** "Prospective" as the on-screen label (Phase 1's Open Question 5 — the analyst flagged this as worth a one-line confirmation with Chuck but it was never explicitly re-confirmed in Phase 2/3; I proceeded with "Prospective" since every later phase's design doc used that exact term without revisiting the question). Also: the helper text under the status select ("Prospective members receive club emails but aren't counted as active members or given portal access until inducted.") and the button tooltip text — both are new copy, not specified verbatim in the Phase 3 design, so worth a glance.
- **UX decisions / tradeoffs made beyond the letter of the design:**
  - Added `focus:ring-2 focus:ring-lions-blue` to the pre-existing Approve/Reject buttons (not just the new one) since I was already touching that JSX block and the CLAUDE.md accessibility gate applies to all interactive controls, not just new ones. Flagging in case qa wants to scope this as a separate tiny fix rather than bundle it here.
  - Application-action-buttons row now wraps to `flex-col` on mobile — a necessary consequence of adding a third button to a `flex gap-2` row that would otherwise be too cramped under ~375px. Verify at 360px per the click-through list above.
  - Did not add a filter "tab" UI (radio-button-style tabs) for prospective/ended — used `<option>` additions to the existing `<select>` instead, matching the Phase 3 design's literal instruction ("add two new `<option>`s") over the Phase 2 architect's looser suggestion of "an explicit filter/tab" — tech-lead's design superseded that open architect suggestion, so no open question here, just noting the lineage.
- **Reminder inherited from api-developer, still outstanding, not this agent's to close:** the manual DB backfill spot-check (every `is_active = false` row reads `membership_status = 'ended'` after migration) has not yet been run against a live database in this pipeline — someone with `.env.local` access needs to do this before/alongside qa's Phase 5 pass.

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
