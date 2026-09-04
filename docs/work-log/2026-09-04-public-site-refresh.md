# Public Site Refresh (batch) — Work Log

> **Slug:** `2026-09-04-public-site-refresh`
> **Surface:** public
> **Permission(s):** none — no new gated surface
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (condensed) — copy/config-level fixes, no schema or permission surface

---

## Source

Live-site review conducted 2026-09-04 (findings supplied directly, no re-review needed). Prior working-tree state already added `/meetings` to `publicPaths` in `src/proxy.ts` and standardized the meeting-schedule wording on `/meetings` and `/about` — not touched here, built on top of.

## Skipped Phases

- **Phase 1 (analyst):** Skipped. Findings were pre-scoped by the live-site review with explicit in-scope/out-of-scope boundaries; no functional ambiguity to refine.
- **Phase 2 (architect):** Skipped. No new directories, dependencies, or structural changes — every change is a copy/config edit inside existing files.
- **Phase 3 (tech-lead):** Skipped. Each item is a one-file, low-risk change; a design doc would add overhead without value.
- **Phase 5 (qa):** Not separately invoked — implementer (full-stack-developer) ran and confirmed the full verification suite per Phase 4 gate (typecheck, unit tests, production build). Flagged for a lightweight qa pass if the user wants a visual click-through before push.
- **Phase 6 (analyst):** Deferred pending user review of this summary.

## What Changed

1. **Homepage service areas** (`src/app/page.tsx`): added "Environment" and "Hunger Relief" `ServiceCard` tiles alongside the existing Youth Programs / Community Service / Humanitarian Aid, reusing `/mission`'s existing copy for those two areas verbatim. Grid changed from `md:grid-cols-3` (3 cards) to `sm:grid-cols-2 lg:grid-cols-3` (5 cards, same card markup/props pattern — `bg-white rounded-2xl shadow-lg hover:shadow-xl` interactive card style, unchanged). No dedicated photography exists yet for these two causes, so both reuse `/images/service-community.jpg` (the project's existing documented fallback image per CLAUDE.md's Zeffy/campaign-card precedent).

2. **"97+ Years of Service" staleness**: found the bug was not a hard-coded literal but a formula bug — both `src/app/page.tsx` and `src/app/about/page.tsx` computed `new Date().getFullYear() - 1928 - 1`, an erroneous extra `-1` that produced 97 instead of the correct 98 for 2026. Removed the stray `-1` in both places so the figure is `new Date().getFullYear() - 1928`, self-correcting every year going forward. Visual presentation unchanged; both are Server Components already, no client conversion needed.

3. **Meeting schedule on `/connect`** (`src/app/connect/page.tsx`): added the schedule line ("1st and 3rd Thursday of each month (September–May) — social hour at 6:30 PM, meeting begins at 7:00 PM") above the existing address block in the "Meeting Location" card, plus a "See full meeting details →" link to `/meetings`, styled with the project's standard inline-link pattern.

4. **Sitemap** (`src/app/sitemap.ts`): added `/meetings`. Checked the dynamic event-entry logic — it already filters to `endDate > now OR endDate IS NULL OR isRecurring`, which excludes concluded one-time past events already; no further filtering change made (not invasive, already effectively correct).

5. **Redirect permanence**: `/causes` (`src/app/causes/page.tsx`) and `/campaigns` (`src/app/campaigns/page.tsx`) used `redirect()` from `next/navigation`, which always issues a 307. Switched both to `permanentRedirect()`, which issues a 308, matching `/contact` → `/connect`'s existing `next.config.ts` 308 entry. (`/causes` and `/campaigns` are page-level redirects, not `next.config.ts` entries — that file's `redirects()` array does not reference either path.)

## Out of Scope (confirmed, not touched)

New `/programs` content, `/join` dues/fee figures, new testimonials, anything under `/members` or `/admin`.

## Verification

- `pnpm exec tsc --noEmit`: PASS (no output)
- `pnpm test`: PASS (85 files, 1712 tests)
- `pnpm build:only`: PASS (all routes compiled, including `/causes`, `/campaigns`, `/meetings`, `/connect`)

## Files Modified

- `src/app/page.tsx`
- `src/app/about/page.tsx`
- `src/app/connect/page.tsx`
- `src/app/sitemap.ts`
- `src/app/causes/page.tsx`
- `src/app/campaigns/page.tsx`

## Handoff Notes

- Not committed per instructions — left in the working tree pending explicit approval.
- Suggest a quick visual pass on `/` (5-card grid at mobile/tablet/desktop breakpoints) and `/connect` (new schedule line + link) before push.
- Redirect status codes (`/causes`, `/campaigns` now 308) are worth a `curl -I` spot check post-deploy since Next.js redirect-type behavior can only be fully confirmed against a running server, not the build log.
