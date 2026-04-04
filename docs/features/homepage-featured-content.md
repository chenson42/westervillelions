# Homepage Featured Content

**Date:** 2026-04-03
**Status:** Planning
**Area:** public-site, admin

## Value

The homepage is static and gets stale quickly. Visitors — potential members, community partners, event attendees — land on it and see the same content indefinitely. Surfacing current events and community activities makes the site feel alive and answers the questions people actually show up with: "What's happening next? Where do I drop off eyeglasses? How do I sign up for the 5K?"

## Description

A dynamic section on the homepage that highlights:
- The next upcoming public event (pulled automatically from the events system)
- A short list of pinned "quick links" or announcements that admins can manage (e.g., eyeglass dropoff locations, plastic for benches, seasonal signups)

The section updates automatically as events change. Pinned items are managed in the admin panel and can be toggled on/off or given a date range so they appear seasonally (e.g., Rudolph 5K link only in Nov–Dec).

## Users

- **Public:** Views the featured content on the homepage (no login required)
- **Admin:** Manages pinned announcements/quick links via admin panel

## Permissions

New admin capability for managing homepage announcements. Likely a new permission or falls under existing content management. TBD during design.

## Functional Requirements

### Next Event Banner / Card
- [ ] Pull the next upcoming event marked as public from the events table
- [ ] Display on homepage: event name, date, brief description, link to event detail or signup
- [ ] If no upcoming public events, section is hidden or shows a fallback message

### Pinned Announcements
- [ ] Admin can create/edit/delete homepage announcements
- [ ] Each announcement has: title, body (short), optional link + link label, optional date range (show after / hide after)
- [ ] Announcements outside their date range are hidden automatically
- [ ] Up to ~3-5 announcements shown at a time (admin can reorder)

### Homepage Layout
- [ ] New section between hero and existing content (or below hero CTA)
- [ ] Mobile-responsive cards or list
- [ ] Contact email or link for items that warrant follow-up (e.g., "Where do I drop off glasses?")

### Admin UI
- [ ] New admin page: `/admin/announcements`
- [ ] Create/edit/delete announcements
- [ ] Toggle active/inactive
- [ ] Set optional start/end date for seasonal items
- [ ] Drag-to-reorder or sort_order field

## Data Model

New table: `homepage_announcements`

```sql
CREATE TABLE IF NOT EXISTS homepage_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  link_url text,
  link_label text,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Homepage — reads next event + active announcements |
| GET | `/admin/announcements` | Admin: list announcements |
| POST | `/api/admin/announcements` | Admin: create announcement |
| PATCH | `/api/admin/announcements/[id]` | Admin: update announcement |
| DELETE | `/api/admin/announcements/[id]` | Admin: delete announcement |

## Out of Scope

- Full CMS / rich text editing for announcements
- Image attachments on announcements
- Member-portal-only announcements (public only for now)
- Push notifications or email blasts triggered by announcements

## Test Cases

- [ ] Next public event appears on homepage automatically
- [ ] When no upcoming public events, section hides gracefully
- [ ] Active announcement with no date range always shows
- [ ] Announcement with future `starts_at` does not show yet
- [ ] Announcement past `ends_at` is hidden automatically
- [ ] Inactive announcement does not show regardless of dates
- [ ] Admin can create, edit, delete, and reorder announcements
- [ ] Homepage renders correctly on mobile

## Open Questions

- Should the next event card link to the public events page or a specific event detail page?
- Should admins be able to pin a *specific* event to the homepage (override the auto-next-event logic)?
- Is there a max character limit for announcement body text we should enforce in the UI?
