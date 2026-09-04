# Homepage / Mission Service-Areas Dedup — Work Log

> **Slug:** `2026-09-04-homepage-mission-dedup`
> **Surface:** public
> **Permission(s):** none — no auth/feature surface touched
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 compressed into the user's direct decision in conversation; Phase 2 (architect) skipped, see rationale below

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | user (direct decision) | Complete | Option 2 chosen | 2026-09-04 |
| 2 — Architectural review | — | Skipped | see rationale | 2026-09-04 |
| 3 — Technical design | user (direct decision) | Complete | see approach below | 2026-09-04 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-04 |
| 5 — Verification | full-stack-developer (typecheck + build only) | Complete | PASS | 2026-09-04 |
| 6 — Shipped vs intent | — | Not run | — | — |

---

## Background

The homepage "Our Service Areas" section and `/mission`'s "How We Serve" section
carried near-duplicate content: the same eight causes, each with its own
one-line (homepage) vs. longer (mission) description, and a near-verbatim
section intro sentence on both pages.

## User-Approved Approach

The user was presented options and chose directly in conversation (no
separate analyst/tech-lead pass needed — this is a content/presentation
consolidation, not a new capability):

- **Keep all eight causes on the homepage** (no trimming to a subset).
- **Shrink the homepage grid to a compact navigation band** — icon + title
  only, no description text.
- **`/mission` remains the deep page** with full descriptions, unchanged in
  substance.
- **Extract a single source of truth** (`src/lib/causes.ts`) for slug,
  title, emoji, and long description, consumed by `/mission`. The homepage
  component keeps its own hand-drawn SVG icon set (homepage-specific,
  keyed by slug) since the shared module holds emoji (used by `/mission`)
  rather than `ReactNode` icons.
- **Order aligned to community-forward** per CLAUDE.md's brand guidance to
  de-emphasize vision: Community Service, Youth Programs, Hunger Relief,
  Environment, Vision, Diabetes Awareness, Childhood Cancer, Humanitarian
  Aid. This matches the homepage's existing order; `/mission` previously
  led with Vision and is now reordered to match.
- **Slugs unchanged** (load-bearing anchor targets): `vision`,
  `hunger-relief`, `environment`, `childhood-cancer`, `diabetes-awareness`,
  `youth-programs`, `community-service`, `humanitarian-aid`.

### Why Phase 2 (architect) was skipped

No new npm dependency, no new top-level directory, no new shared primitive
beyond one small data-only lib module (`src/lib/causes.ts`) that follows
the existing `src/lib/*.ts` convention exactly. No invariant is touched.
The user's decision already fixed the placement and shape, leaving nothing
for an architectural review to adjudicate.

---

## Phase 4 — Implementation

### Files Created

- `src/lib/causes.ts` — shared `Cause[]` (slug, title, emoji, long
  description), community-forward order, slugs preserved from the prior
  mission-page array.

### Files Modified

- `src/app/mission/page.tsx` — removed its local `causes` array; now
  imports `causes` from `@/lib/causes`. Rendering unchanged (cards with
  `id={slug}`, `scroll-mt-24`, emoji, title, long description). Metadata
  and JSON-LD breadcrumb untouched. Only the `cause.icon` → `cause.emoji`
  field-name reference changed to match the shared type.
- `src/components/home/service-areas.tsx` — now imports `causes` from
  `@/lib/causes` for slug/title/order; keeps its own `icons: Record<string,
  ReactNode>` map keyed by slug for the hand-drawn SVGs (unchanged path
  data). Cards dropped their description paragraph — now icon + title
  only, in a centered layout, still `bg-white rounded-2xl shadow-lg
  hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden`
  with `focus:outline-none focus:ring-2 focus:ring-lions-blue`, still a
  2-col mobile / 4-col desktop grid, still linking to `/mission#<slug>`.
  Section intro reworded from the near-verbatim mission-page line to "The
  eight global causes we serve — here in Westerville and around the
  world." Gold divider bar, heading, and the "Learn more about how we
  serve" arrow link to `/mission` are unchanged.

### Schema Changes

None.

### Implementer Notes

- No change to `src/app/page.tsx` — it already just renders
  `<ServiceAreas />` with no props.
- Card padding kept comfortable (`p-5 sm:p-6`) despite dropping the
  description, so the icon+title tap target stays well above the 44px
  guideline even though the cards are visually lighter.
- Ran `pnpm exec tsc --noEmit` and `pnpm build:only` per the task; results
  below.

---

## Verification (typecheck + build only — full QA/Phase 5 not run)

**Date:** 2026-09-04

### Type Check

`pnpm exec tsc --noEmit`: PASS

### Production Build

`pnpm build:only`: PASS

### Manual Click-Through

Not performed in this pass — recommend a follow-up `qa` pass (or the
user's own dev-server check) to confirm:
- Homepage grid renders 2-col mobile / 4-col desktop, icon + title only.
- Each homepage card links to the correct `/mission#<slug>` anchor and the
  target section is not hidden behind the fixed header (`scroll-mt-24`
  still present on `/mission`'s cards).
- `/mission` cards now render in the new community-forward order with full
  descriptions intact.

## Open Questions / Handoff Notes

- No new `FEATURES` key, schema, or env var — nothing to document beyond
  this log.
- Next agent: `qa` (Phase 5, if the full pipeline gate is desired for this
  content change) or the user directly, since Phases 1–3 were already
  compressed into the user's conversational decision. Phase 6
  (shipped-vs-intent) was not run.

---

## Addendum — Icon Unification (2026-09-04, same day)

Follow-up approved by the user in conversation: use the identical
hand-drawn SVG stroke icons on both the homepage and `/mission`, instead
of the homepage using SVGs and `/mission` using emoji.

### Files Created

- `src/components/cause-icon.tsx` — new shared `CauseIcon({ slug,
  className, ...svgProps })` component. Holds the per-cause `<path>` data
  (byte-identical to what previously lived inline in
  `service-areas.tsx`), keyed by the same slugs as `src/lib/causes.ts`.

### Files Modified

- `src/components/home/service-areas.tsx` — removed the inline `icons`
  map; now renders `<CauseIcon slug={cause.slug} className="h-6 w-6" />`
  inside the same `h-11 w-11 rounded-xl bg-lions-blue/10 text-lions-blue`
  badge as before. Visual output is unchanged — same markup, same
  classes, same path data, just sourced from the shared component.
- `src/app/mission/page.tsx` — replaced the `{cause.emoji}` text render
  with a `CauseIcon` inside a badge matching the homepage treatment
  (`h-11 w-11 rounded-xl bg-lions-blue/10 text-lions-blue`, `mb-3` to
  preserve the prior spacing). Title, long description, `id={slug}`
  anchor, and `scroll-mt-24` are unchanged.
- `src/lib/causes.ts` — removed the now-unused `emoji` field from the
  `Cause` type and every entry, after confirming via `grep -rn "\.emoji"
  src/` that nothing else referenced it.

### Verification

- `pnpm exec tsc --noEmit`: PASS
- `pnpm build:only`: PASS
- Homepage confirmed to render identically (same wrapper markup/classes,
  same icon path data — only the SVG's source module changed).
- Not committed or pushed, per instruction. A dev server on port 4200 was
  left running and untouched.
