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
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
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

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions

- Permission key(s): `area.action`
- Default role bindings: [list]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → add migration in `drizzle/migrations/` and update `src/lib/db/schema.ts`
2. `FEATURES` entry in `src/lib/permissions.ts` + role binding migration
3. Route handlers / server actions
4. UI
5. Email notification (if applicable) — enqueue via `sendEmail` in `src/lib/email.ts`
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

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
