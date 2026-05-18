# Member User Auto-Provisioning

**Date:** 2026-05-17
**Status:** Planning
**Area:** admin / api

## Value

Every active member of the club needs a `users` row so they can RSVP to events, be assigned to groups, and log into the member portal. The current admin "create member" form (`POST /api/admin/members`) creates a member row but **never creates the corresponding user account**. The newer membership-application approval flow does it correctly, but the direct admin-create path does not — leading to orphaned members.

This was discovered when Paul Cook, created directly by an admin, had no user account and could not be RSVP'd to a Farmer's Market occurrence. He had to be patched up manually. We want this class of bug to be impossible going forward.

## Description

When an admin creates a member through any path, the system also provisions a user account, assigns the "member" role, and emails the new member a welcome message with instructions for logging into the member portal.

## Users

Admins with `members.edit` permission (existing). No new permission required.

## Permissions

None added. Reuses existing `members.edit` gate.

## Functional Requirements

### Schema
- [ ] Migration: make `members.email` `NOT NULL`
- [ ] Migration: add case-insensitive unique index on `members.email` (e.g. `CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique_ci ON members (lower(email))`)
- [ ] Update `src/lib/db/schema.ts` to mark email `.notNull()` and add the unique index
- [ ] Idempotent: pre-flight survey confirms 0 rows missing email and 0 case-insensitive duplicates, so the constraint should apply cleanly

### Shared helper
- [ ] Extract a `provisionUserForMember({ email, firstName, lastName, memberId })` helper (likely in `src/lib/members.ts` or `src/lib/users.ts`) that encapsulates: case-insensitive existing-user lookup, user creation, member-role assignment, password-reset token generation, welcome email queueing, and member ↔ user linking
- [ ] Helper returns `{ userId, wasExisting }` so callers can flag whether an existing user was linked vs. a new one created
- [ ] If an existing `users` row with that email already has a *different* `member_id`, the helper must error (don't silently steal the link)

### `POST /api/admin/members` (`src/app/api/admin/members/route.ts`)
- [ ] Reject if `email` is missing or empty → 400 `"Email is required"`
- [ ] Reject if a member with the same email (case-insensitive) already exists → 409 `"A member with this email already exists"`
- [ ] After inserting the member, call `provisionUserForMember(...)`
- [ ] Return the new member with `{ userLinked: 'created' | 'existing' }` in the response

### `PUT /api/admin/members/[id]` (`src/app/api/admin/members/[id]/route.ts`)
- [ ] If email is omitted or empty in the payload → 400 (cannot remove email)
- [ ] If email changes, validate case-insensitive uniqueness across other members → 409 if taken
- [ ] If email changes and there is a linked `users` row, update `users.email` to match (preserves login)
- [ ] If the member has no linked user at all (legacy data), provision one as a side effect

### Membership-application approval (`src/app/api/admin/membership-applications/[id]/route.ts`)
- [ ] Refactor to call the shared `provisionUserForMember` helper instead of inlining the logic
- [ ] Behavior should be identical to today

### Welcome email
- [ ] Reuse the existing `sendWelcomeEmail(email, fullName, token)` helper (already in use by application-approval flow)
- [ ] Verify the email body covers both auth methods: "Set your password via this link [token URL]" and "or sign in with the Google account that matches this email address"
- [ ] No new template needed unless the existing one omits the Google OAuth note — confirm during implementation

### Admin UI (`src/components/admin/members/...`)
- [ ] Member-create form: mark email as required (asterisk + `required` attribute)
- [ ] Member-edit form: same
- [ ] Surface duplicate-email 409 error inline

## Data Model

No new tables. Schema delta:
```
ALTER TABLE members ALTER COLUMN email SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique_ci ON members (lower(email));
```

## Routes

No new routes. Behavior change to existing:
- `POST /api/admin/members`
- `PUT /api/admin/members/[id]`
- `POST /api/admin/membership-applications/[id]` (refactor only, no behavior change)

## Out of Scope

- Backfilling user accounts for existing orphaned members. The pre-flight survey shows zero remaining orphans after Paul Cook was patched.
- Changing how member-portal login works (Google OAuth + password remain unchanged).
- Sending welcome emails to members who already have user accounts.
- Bulk member import flows (if any exist — not in this scope).

## Test Cases

- [ ] Create member with new email → member row created, user row created, member-role assigned, password-reset token row created, welcome email queued, `users.member_id` points to new member
- [ ] Create member with email that already belongs to a user but no member (e.g. someone who signed up via OAuth without applying) → user is linked to new member, no new user created, no second welcome email sent
- [ ] Create member with email that already belongs to another member → 409
- [ ] Create member with missing email → 400
- [ ] Create member with email differing only in case from existing → 409
- [ ] Edit member, change email → users.email updated, no second welcome email
- [ ] Edit member, change email to one used by another member → 409
- [ ] Edit member with no linked user (shouldn't exist after this feature ships, but defensively) → user is provisioned
- [ ] Approve membership application → unchanged behavior (still creates member + user + welcome email)
- [ ] Migration runs cleanly against current data (survey confirmed safe)

## Open Questions

- Should `PUT` warn or block if the email change would orphan an `accounts` row (NextAuth Google OAuth linked to the old email)? Probably leave NextAuth records alone and let the user re-link via Google sign-in. Confirm with user before implementing.
- Welcome email body — does the existing template already mention Google OAuth login as an option, or do we need to update it? Verify during implementation.
