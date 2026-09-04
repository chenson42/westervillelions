# Homepage Event Cards Link to Event Details — Work Log

> **Slug:** `2026-09-04-homepage-event-card-links`
> **Surface:** public homepage
> **Permission(s):** none (public)
> **Estimated complexity:** trivial
> **Pipeline mode:** Bug-fix variant, condensed

## Root Cause

`NextEventCard` in `src/components/home/featured-content.tsx` rendered the homepage
"Upcoming Events" cards as plain `<article>` elements with the interactive-card hover
styling (shadow lift + translate) but no link — the styling promised clickability the
markup didn't deliver. Only the "See All Events" text link below the cards navigated.

## Reproduction

Load the homepage, click anywhere on an Upcoming Events card → nothing happens.

## Fix

Wrapped the card in a `<Link href={/events/[id]}>` with an aria-label and the standard
focus ring; the event `id` was already present in the card's props.

## Phases skipped

Phases 1–3 and 6 skipped (one-component, no-schema, no-permission UI fix applying an
existing pattern); Phase 5 condensed to typecheck + production build (both pass) — the
change is a static wrapper element with no logic to unit-test.
