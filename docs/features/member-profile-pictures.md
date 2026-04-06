# Member Profile Pictures

**Date:** 2026-03-26
**Status:** Complete
**Area:** member-portal, admin, public-site

## Value
Makes the member directory and About page leadership section more personal and human. Visitors and prospective members can connect faces to names, increasing trust and community feel.

## Description
Members can upload and crop a profile photo from their profile page. Photos appear in the member directory (member portal) and on the public About page leadership section. Admins can manage any member's photo from the admin edit page. A gender-neutral shadow silhouette is shown when no photo is available.

## Users
- **Display (public):** Leadership photos visible on `/about` (no auth)
- **Display (members):** Directory photos visible in member portal
- **Upload own photo:** All authenticated members via `/members/profile`
- **Manage any photo:** Admins via `/admin/members/[id]/edit`

## Permissions
No new permission needed — uses existing member profile edit for self-management and admin access for admin management.

## Functional Requirements
- [ ] Add `profile_picture` TEXT column to `members` table (stores URL or base64 data URI)
- [ ] Image upload UI with client-side crop-before-upload (react-image-crop or similar)
- [ ] Crop enforces square aspect ratio
- [ ] Uploaded image stored as base64 data URI on `members.profile_picture`
- [ ] Profile page (`/members/profile`) — upload/replace/remove own photo
- [ ] Admin member edit page — upload/replace/remove any member's photo
- [ ] Member directory shows photo (or shadow avatar fallback)
- [ ] About page leadership grid shows photo (or shadow avatar fallback)
- [ ] Shadow avatar SVG shown inline when no photo present
- [ ] Seed: board members get example photos of famous people (gender-matched)

## Data Model
**New column on `members` table:**
```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_picture TEXT;
```
Stores a base64 data URI (e.g. `data:image/jpeg;base64,...`) or a remote URL. No new tables needed.

## Routes

### New API routes
- `POST /api/members/profile-picture` — authenticated member uploads own photo (body: `{ memberId, imageDataUri }`)
- `DELETE /api/members/profile-picture` — authenticated member removes own photo
- `POST /api/admin/members/[id]/profile-picture` — admin uploads photo for any member
- `DELETE /api/admin/members/[id]/profile-picture` — admin removes photo for any member

### Modified pages
- `src/app/members/profile/page.tsx` — add photo upload/crop/remove UI
- `src/app/(dashboard)/admin/members/[id]/edit/page.tsx` (or similar) — add photo management
- `src/app/about/page.tsx` — show photo in leadership grid
- `src/components/members/member-directory.tsx` — show photo in member cards

## Out of Scope
- Cloud/CDN storage (using base64 in DB for simplicity; can migrate later)
- Multiple photos per member
- Photo moderation workflow
- Public member profile pages

## Test Cases
- [ ] Member can upload a photo and see it in their profile
- [ ] Crop UI enforces square output
- [ ] Photo appears in member directory after upload
- [ ] Board member photo appears on About page leadership section
- [ ] Shadow avatar shown when member has no photo
- [ ] Admin can upload/remove photo for any member
- [ ] Removing photo reverts to shadow avatar
- [ ] Seed photos appear for board members

## Open Questions
- Max image size? Recommend enforcing ≤ 500KB after crop/compression on client
- Should photos be visible to all authenticated members or only admins in the directory?
  - *Recommendation: all authenticated members (matches current directory access)*
