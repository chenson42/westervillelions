# Collage page art (bug-fix variant stub)

**Date:** 2026-11-04
**Request:** "can we dress up the collage page with some of the art that we used for the santasworkshop page?"
**Phases skipped:** 1, 2, 3, skipped by the orchestrator: visual-only change to an existing page, no schema, data, API, permission or dependency change, no new image files.

## What changed
- New `src/components/santas-workshop/collage/collage-decor.tsx` (server components): header train, footer train, and a small state icon, all reusing the existing `Art` / `TrainMotif` and art slots (`train`, `step-photos`, `step-pickup`, `story-art`). All decorative (empty alt), all `sw-noprint`.
- `src/app/santas-workshop/c/[token]/page.tsx`: train along the foot of the blue header; train above the footer; icon above the unpublished (`step-photos`), removed (`step-pickup`) and empty-live (`story-art`) messages.
- Test added to `collage-page-source.test.ts`: art present in all three states, every art image has `alt=""`.
- Not touched: what the collage lists, photo serving, `photo-access.ts`, copy strings, noindex / force-dynamic / no-referrer. The family page (`/f/[token]`) is unchanged and its print layout is unaffected (art lives only in the collage page and is `sw-noprint`).

## Gates
See the hand-off message for results.
