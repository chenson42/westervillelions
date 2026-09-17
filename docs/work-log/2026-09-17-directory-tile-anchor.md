# Member Directory tile scrolls to the directory — Work Log

> **Slug:** `2026-09-17-directory-tile-anchor`
> **Surface:** (dashboard) member portal (`/members`)
> **Permission(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phases 1, 2, 3, 5, 6 skipped (two-line client-side link/anchor change; no invariants, schema, or server logic touched).

---

## Root cause

The "Member Directory" tile on the portal home linked to `/members` — the page it was already on. The directory renders on that same page below the six tiles and the birthdays band, so clicking the tile reloaded the page and left the user at the top looking at the same tiles. Every other tile leads to its own page with a "Back to Member Portal" link, so this one read as "went somewhere with no navigation."

## Reproduction (pre-fix)

1. Sign in, land on `/members`.
2. Click the "Member Directory" tile.
3. Page reloads at the top; nothing visibly changes. On a phone the directory is well below the fold.

## Fix

The directory section now carries `id="directory"` with `scroll-mt-24` (clears the sticky header), and the tile links to `/members#directory`. The tile also gained the same focus ring the other tiles have. Option 2 (a separate `/members/directory` route with hero + back link) was considered and deferred — it would move a URL and the printable directory with it.

## Verification

- `pnpm exec tsc --noEmit` — pass
- Playwright click-through on local dev at 1280px and 400px: URL becomes `/members#directory`, page scrolls so the "Member Directory" heading sits just below the sticky header with the search box and filters in view.
