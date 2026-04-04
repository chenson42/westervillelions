# Google Groups Sync for Portal Groups

**Date:** 2026-04-03
**Status:** Planning
**Area:** admin, member-portal, integrations

## Value

Groups in the portal currently have no email presence. This feature gives each group a contact email address at `@westervillelions.org` and keeps the corresponding Google Group's membership in sync with the portal automatically. Members and the public can email a group directly; admins no longer need to maintain Google Groups manually.

## Description

**Admin side:**
- Each group gains an optional email prefix field (e.g., `board` → `board@westervillelions.org`)
- A "Sync Now" button in the admin group editor triggers an immediate sync with Google Groups
- Adding or removing a member from a group in the portal automatically syncs the change to Google Groups
- Sync status (last synced, error state) is visible in the admin UI

**Member portal side:**
- New Groups page listing all groups with their contact email (if set)
- Click into a group to see its member list and the contact email prominently displayed

**Google Groups behavior:**
- External users can email the group (open posting policy)
- Members of the Google Group are kept in sync with portal group membership
- Google Group is created automatically if it doesn't exist yet

## Users

- **Admin:** Configure group email, trigger manual sync (requires `groups.manage` permission)
- **All authenticated members:** View groups listing and group detail pages

## Permissions

No new permissions needed. Admin sync uses the existing `GROUPS_MANAGE` feature permission. The member portal groups page is visible to all authenticated users.

## Functional Requirements

### Schema
- [ ] Add `emailPrefix` (nullable text) column to the `groups` table
- [ ] Add `googleGroupSyncedAt` (nullable timestamp) and `googleGroupSyncError` (nullable text) columns to `groups` table

### Google API Integration
- [ ] Set up Google Admin SDK service account credentials (prerequisite — not yet configured)
- [ ] Service account needs domain-wide delegation with `https://www.googleapis.com/auth/admin.directory.group` scope
- [ ] Implement `syncGoogleGroup(groupId)` server-side utility:
  - Resolve full email from prefix (`prefix@westervillelions.org`)
  - Create Google Group if it doesn't exist (open posting, members-only viewing)
  - Fetch current Google Group members
  - Add members present in portal but missing from Google Group
  - Remove members in Google Group but not in portal (use member emails)
  - Update `googleGroupSyncedAt` / `googleGroupSyncError` on the group record

### Admin UI
- [ ] Add email prefix input to the group edit form — admin types prefix, UI shows `@westervillelions.org` suffix
- [ ] "Sync Now" button that calls `POST /api/admin/groups/[id]/sync`
- [ ] Display last synced timestamp and any sync error below the email field

### API Routes
- [ ] `POST /api/admin/groups/[id]/sync` — trigger manual sync (admin only)
- [ ] Patch existing `POST/PUT /api/admin/groups/[id]/members` — call `syncGoogleGroup` after member add/remove

### Member Portal
- [ ] New page: `/members/groups` — list all groups, show name, description, and contact email if set
- [ ] New page: `/members/groups/[id]` — group detail with contact email highlighted at top, member list below
- [ ] Add "Groups" link to the member portal navigation

## Data Model

```sql
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS email_prefix text,
  ADD COLUMN IF NOT EXISTS google_group_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_group_sync_error text;
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/members/groups` | Member portal groups listing |
| GET | `/members/groups/[id]` | Member portal group detail |
| POST | `/api/admin/groups/[id]/sync` | Admin: trigger Google Group sync |

Existing routes modified:
- `POST /api/admin/groups/[id]/members` — add sync call after member change
- `DELETE /api/admin/groups/[id]/members/[memberId]` — add sync call after member removal

## Out of Scope

- Syncing group metadata (name, description) back from Google to the portal
- Google Calendar integration
- Email delivery tracking or bounce handling
- Non-`@westervillelions.org` email addresses
- Subgroups or nested groups

## Prerequisites

Before the Google integration can be implemented:
1. Enable the Admin SDK API in the Google for Nonprofits Google Cloud project
2. Create a service account with domain-wide delegation
3. Grant the service account the `https://www.googleapis.com/auth/admin.directory.group` scope in Google Workspace Admin → Security → API Controls
4. Download the service account JSON key
5. Add credentials to environment: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL` (an admin account to impersonate)

## Test Cases

- [ ] Admin can save an email prefix and it persists
- [ ] "Sync Now" creates a new Google Group when none exists
- [ ] "Sync Now" adds missing members to an existing Google Group
- [ ] "Sync Now" removes members no longer in the portal group
- [ ] Adding a member in admin triggers an automatic sync
- [ ] Removing a member in admin triggers an automatic sync
- [ ] Sync error is displayed in the admin UI when Google API fails
- [ ] Member portal groups page shows all groups and their emails
- [ ] Group detail page shows members and highlights the contact email
- [ ] Groups with no email prefix show no email on the portal page

## Open Questions

- Should the "Sync Now" button be disabled / hidden when no email prefix is set?
- Should sync failures block the member add/remove action or fail silently (fire-and-forget)?
- Should portal members be added to the Google Group as MEMBER or OWNER type? (Likely MEMBER)
- When a group's email prefix is changed or cleared, should the old Google Group be deleted or left alone?
