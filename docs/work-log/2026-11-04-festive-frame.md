# Festive Santa's Workshop frame (2026-11-04)

**Request:** "lets also make the frame feel more christmasy" (the 4x6 frame, DECISION-124).
**Phases 1-3:** skipped by the orchestrator: visual-only, inside DECISION-124's constraints (no schema, no API, no new dependency, no stored output).
**Root/Change:** the drawn default frame (used when no `frame-art` PNG is supplied) is now deep pine green with a candy-cane border (outside the 38 px trim safe zone), gold inner line, holly and berries at the top corners, a red string-of-lights ring around the photo window (drawn outside the window only), seeded snowflakes in free space, a gold "A Visit to Santa's Workshop" title with "Merry Christmas from the Westerville Lions · <year>", cream/white name and caption, gold URL and frame number, and a gold halo outside the white QR plate. Geometry is pure and unit-tested in `src/lib/santas-workshop/frame-layout.ts` (`computeDecor`, `computeSnowflakes`).
**Unchanged:** photo window (75, 225, 1050 x 990), QR plate size and module size, quiet zone (pure white), practice band, 1200 x 1800 JPEG at 300 dpi, nothing stored, `frame-art` path (art mode keeps the previous cream background and blue text).
**Files:** `src/lib/santas-workshop/frame-layout.ts`, `src/lib/santas-workshop/frame-layout.test.ts`, `src/components/admin/santas-workshop/frame-compose.ts`.
**Gates:** see the final report of this change (tsc, lint, test, build:only).
