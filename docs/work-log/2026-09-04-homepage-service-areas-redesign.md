# Homepage UX Tune-Up + Service Areas Redesign — Work Log

> **Slug:** `2026-09-04-homepage-service-areas-redesign`
> **Surface:** public
> **Permission(s):** none — public pages, no gates
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — UI-only tune-up on the main-thread's explicit design direction. Phases 1–3 skipped (design direction decided on the main thread; no schema/API/permissions). Phase 5 condensed to typecheck + unit tests + production build run by the implementer.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped — direction fixed by main thread | — | 2026-09-04 |
| 2 — Architectural review | architect | Skipped — no new deps/dirs/invariants | — | 2026-09-04 |
| 3 — Technical design | tech-lead | Skipped — design direction supplied in the task brief | — | 2026-09-04 |
| 4 — Implementation | ux-developer | Complete | — | 2026-09-04 |
| 5 — Verification | ux-developer (condensed) | Complete | tsc + tests + build PASS | 2026-09-04 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# UX Review Findings (Phase 1 substitute)

Reviewed `src/app/page.tsx`, `src/components/home/service-card.tsx`, `src/components/home/featured-content.tsx`, against `src/app/mission/page.tsx`. The Upcoming Events cards were already made clickable earlier today — not re-flagged.

## Implemented in this pass (high value, low risk)

1. **[HIGH] Service Areas section stale and misleading.** Showed 5 of the club's 8 causes; three cards reused the same photo (`service-community.jpg`); photos were grayscaled and dated; cards carried the interactive hover treatment (lift + shadow) but were **not clickable** — a broken affordance. → Redesigned (see below).
2. **[MED] Internal navigation via `<a>` instead of `next/link`.** Hero ("Join the Club", "Attend a Meeting") and bottom CTA ("Support Our Mission", "Get in Touch") forced full page loads. → Converted to `<Link>`.
3. **[MED] Missing focus rings on hero and CTA buttons.** CLAUDE.md requires visible focus styles on all interactive links. → Added (`focus:ring-white` + blue ring-offset on the dark hero; `focus:ring-lions-blue` on the light CTA band).
4. **[LOW] Filler stat.** "100% Community Focused" is a slogan posing as a statistic next to two real numbers. → Replaced with "8 / Causes We Serve", which also primes the redesigned section below it.
5. **[LOW] Dead import.** `ZeffyButton` was imported in `page.tsx` but never rendered. → Removed. Also deleted the now-orphaned `service-card.tsx`.
6. **[LOW] No deep-link targets on /mission.** Homepage cards had nowhere specific to land. → Added `id={slug}` + `scroll-mt-24` to each cause card and `id="how-we-serve"` on the section (additive attributes only; no rendering change to /mission).

## Recommended only (not done — needs discussion or is riskier)

1. **Hero photo is ~90% obscured.** The blue gradient overlay (`from-lions-blue/90 to-lions-blue-dark/90`) sits *on top of* `hero-bg.jpg`, so the photo barely reads while still costing a full-bleed download. Either lighten the overlay (e.g. /70) or drop the image. Hero structure was explicitly off-limits for this pass.
2. **"Stay Connected" section carries two jobs.** One `h2` governs both social-follow pills and the events/announcements grid; the two content types deserve separate headings (or the FeaturedContent's own "What's Happening" heading un-embedded). Restructuring risks visual churn — recommend a follow-up.
3. **Social pills use `rounded-full`.** CLAUDE.md's button rule says `rounded-lg` always; these are arguably chips, not buttons, but worth a ruling for consistency.
4. **`hover:scale-105` on hero/CTA buttons** is not part of the documented button spec — either bless it as the hero variant in CLAUDE.md or remove it.
5. **Social pill tap height ~42px** (py-2.5 + text) — marginally under the 44px target; `py-3` would clear it.
6. **CLAUDE.md brand hexes drift from the code.** Docs say `#1a56db`/`#FFD700`; Tailwind defines `#003F87`/`#F9B222`. Tokens are consistent in code, but the doc should be corrected (30-day documentation review candidate).

---

# Phase 4 — Implementation

## Files Created

- `src/components/home/service-areas.tsx` — new server component: "Our Service Areas" section with all eight Lions global causes (order community-forward, Vision mid-list per Brand Guidelines), each card a `<Link>` to `/mission#<slug>`. Icons are hand-drawn 24×24-grid stroke SVGs (strokeWidth 1.5, round caps — matching the site's existing heroicon-style inline SVGs), no icon library. Card = mandated interactive convention (`rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden`) + tinted `bg-lions-blue/10` icon tile that inverts to solid blue/white stroke on hover/focus. Gold appears once, as a short rule under the section heading (accent, not a border). Grid: `grid-cols-2 lg:grid-cols-4` (2×4 mobile → 4×2 desktop). Section footer link "Learn more about how we serve →" to /mission.

## Files Modified

- `src/app/page.tsx` — swapped the five-photo-card section for `<ServiceAreas />`; `<a>`→`<Link>` for internal hrefs; focus rings on hero + CTA buttons; third stat now "8 Causes We Serve"; removed dead `ZeffyButton` import.
- `src/app/mission/page.tsx` — additive only: `slug` field per cause, `id={slug}` + `scroll-mt-24` on each cause card, `id="how-we-serve"` on the section.

## Files Deleted

- `src/components/home/service-card.tsx` — orphaned (homepage was its only consumer; verified by grep). `service-youth.jpg` / `service-humanitarian.jpg` are now unreferenced but left in `public/images/`; `service-community.jpg` remains the campaign-card fallback (kept).

## Schema Changes

None.

## Implementer Notes

- Whole card is the link (well over 44px touch target); SVGs are `aria-hidden` since each card's visible title names the destination.
- Homepage cause descriptions are tightened one-liners mirroring /mission's framing (not verbatim) so 2-col mobile cards stay compact — copy the club may want to refine.
- No `'use client'` needed anywhere — old ServiceCard's client-side image-error state is gone with the photos.

---

# Phase 5 — Verification (condensed)

**Date:** 2026-09-04 · **Verified by:** ux-developer

- `pnpm exec tsc --noEmit`: PASS
- `pnpm test`: PASS
- `pnpm build:only`: PASS
- No native dialogs, no `console.log`, no new dependencies.

Manual click-through for qa/analyst: homepage → each of the 8 cards lands on its /mission card; keyboard-tab the hero, cards, and CTA buttons for visible rings; check the 2-col grid at 360px; confirm "Learn more about how we serve" link; confirm the stats row's third figure reads "8 / Causes We Serve".

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
