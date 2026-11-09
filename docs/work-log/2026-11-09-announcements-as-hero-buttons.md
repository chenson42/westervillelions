# Homepage announcements as hero buttons — Work Log

> **Slug:** `2026-11-09-announcements-as-hero-buttons`
> **Surface:** public homepage + admin announcements
> **Permission(s):** existing `announcements.manage` covers this
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — orchestrator-implemented at the user's request ("build it and push"); Phases 1, 2, 3 and 6 skipped (no schema, no permission, no new route; one pure helper and a render change), Phase 5 done inline (below)

## Request (user's words)

- "turning on santasworkshop. how do i link the home page to santasworkshop?"
- "i thought the announcement creates the big button in the hero"
- "yes build it and push. it should be generic. i think announcements should only show up as buttons."

## Before

The hero button was hard-coded to White Cane (`linksToWhiteCane()` + `campaignState() === "live"` in `src/app/page.tsx`). Every other announcement rendered only as a card in What's Happening.

## Change

- `src/lib/homepage-hero-buttons.ts` (+ test): `heroAnnouncementButtons()` turns the active, in-window rows (sort order) into at most two buttons; label = `linkLabel` else title; http(s) links open in a new tab.
- `src/app/page.tsx`: first button gold, second outlined, then Join the Club outlined; none → Join + Attend a Meeting (unchanged). White Cane special case and its `campaignState` gate removed: the announcement's end date is now the only switch.
- `src/components/home/featured-content.tsx`: announcement list removed; What's Happening is upcoming events only.
- Admin form + `POST`/`PATCH /api/admin/announcements`: link URL required (400 if missing or cleared); body relabelled "Notes (not shown on the website)".
- CLAUDE.md: White Cane line updated; new "Homepage announcements are hero buttons only" entry.

## Verification

- `pnpm exec tsc --noEmit`: pass. `pnpm lint`: 0 errors (2 pre-existing warnings in other files). `pnpm test`: 347 files / 5974 tests pass. `pnpm build:only`: pass.
- Dev server: no active announcement → hero shows Join the Club (gold) + Attend a Meeting, no Announcements list. With a temporary dev-DB announcement (`/santas-workshop`, blank label) → gold "Santa's Workshop - Sign Up Now" linking to `/santas-workshop`, then outlined Join the Club. The temporary row was deleted.
- e2e not run for this change (no spec covered the homepage announcement list; `e2e/white-cane.spec.ts` tests the White Cane page, not the homepage).

## Production state at ship (read-only check)

Active announcement "Santa's Workshop - Sign Up Now" → `/santas-workshop`, ends 2026-12-19 23:00 UTC; the button will show from deploy until then. (Sign-ups close Dec 16; the user may want to move the end date.) The White Cane announcement ended 2026-11-01.

## Production write — Santa's Workshop event (2026-11-09)

User's words: "can you also add an event for me for the santa's workshop and pin it to the home page? you can reuse the artwork that we already have."

One guarded `INSERT INTO events … WHERE NOT EXISTS (same title and start)`: "A Visit to Santa's Workshop", 2026-12-18 16:00–19:00 (drop-off evening; the description covers Saturday photos and Sunday 1–3 PM pickup and links to `/santas-workshop`), location "IHOP, Westerville", image `/images/santas-workshop/og.jpg`, `is_public = true`, `is_featured = true`, no RSVP, `created_by` NULL. Description checked against `src/components/santas-workshop/banned.ts` before insert (clean).

- **Before:** events 51; featured upcoming 1 (Rudolph Run 2026).
- **After:** events 52; featured upcoming 2. New id `40886eae-252c-4cbf-89a1-b2cacbbfa4e1`.
