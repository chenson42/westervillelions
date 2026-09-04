# Admin Nav Type-to-Filter Search

**Slug:** admin-nav-search
**Started:** 2026-09-04
**Type:** Feature (UI-only, additive nav metadata)

Apple-Settings-style search field at the top of the admin sidebar: live fuzzy
filtering of the visible menu items as the user types, across label + group
header + new search keywords.

## Pipeline notes — condensed run

Phases 1–3 (analyst / architect / tech-lead) were **skipped deliberately**:
UI-only change, no schema, no API, no permission changes, no new npm
dependency. The single structural risk — adding a field to `ADMIN_NAVIGATION`
entries — was verified against DECISION-082 (see below) instead of running a
full architectural review. Phase 5 was folded into Phase 4 (typecheck, full
unit suite, production build, live Playwright screenshot pass by the
implementer).

## Phase 4 — Implementation (UI) — 2026-09-04

**Owner:** ux-developer
**Status:** complete

### Summary

Added an optional, additive `keywords: string[]` field to every
`ADMIN_NAVIGATION` entry, a dependency-free fuzzy subsequence matcher with
unit tests, and a type-to-filter search input at the top of the admin sidebar.
Search filters strictly WITHIN the permission-visible items (it can never
widen visibility), preserves nav order, hides empty groups, highlights matched
label characters, and clears on Escape / ✕ / navigation.

### Proxy-derivation verification (DECISION-082)

`getAdminProtectionRules()` and `canAccessAdminArea()` read only `href` and
`requiredFeature` from nav items — confirmed by reading the derivation in
`src/lib/permissions.ts` before adding the field. `keywords` is therefore
invisible to proxy admission and area gating. The untouched
`permissions.test.ts` derivation suite ("every ADMIN_NAVIGATION item with a
requiredFeature is admitted by a derived rule...") and
`admin-page-feature-gates.test.ts` both pass unchanged (1867/1867 tests
green).

### What I did

- `AdminNavItem` gained optional `keywords?: string[]`; populated synonyms on
  all 36 entries ("what would someone type?" — Ledger → money/accounting/
  books/finance, Email Queue → mail/outbound/blocked, Social Requests →
  facebook/instagram/posts, etc.).
- `src/lib/fuzzy-match.ts`: case-insensitive subsequence matcher trying every
  viable start position; prefix > word-start > mid-word, contiguous runs beat
  scattered letters, capped gap penalty; returns match positions for
  highlighting. `matchNavEntry()` layers source priority: label always
  outranks keyword, keyword always outranks group header.
- `src/lib/fuzzy-match.test.ts`: 17 unit tests (case-insensitivity, null on
  no-match/empty query, position correctness, all scoring orderings,
  best-alignment-not-greedy, hyphen word boundaries, source ranking).
- `admin-sidebar.tsx` (already a client component — no server/client split
  needed): search input with magnifier icon, ✕ clear button, sr-only label,
  44px (`h-11`) field height, brand focus ring; Escape clears; query clears
  on nav-link click; convention empty state ("No matches for ...");
  matched label characters render bold lions-blue (lions-gold on the active
  blue item). Mobile drawer unaffected — the input lives inside the existing
  sidebar panel.

### Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 99 files / 1867 tests pass (includes the new fuzzy-match
  suite and the untouched proxy-derivation + admin-page-feature-gates suites).
- `pnpm build:only` — production build passes.
- Live Playwright pass against `pnpm dev` with the e2e admin fixture:
  filtered by "em" (label highlights on Members/Permissions/Reimbursements;
  keyword hits on Dues/Reports/Donors/Groups; Records/Engagement groups with
  matches retained, empty groups hidden), "zzzz" empty state, and
  Escape-clears all verified via screenshot. Dev server killed afterward.

### Outputs

- `src/lib/permissions.ts` — `keywords` field + synonyms on all entries
- `src/lib/fuzzy-match.ts`, `src/lib/fuzzy-match.test.ts` — new
- `src/components/admin/admin-sidebar.tsx` — search UI

### Open questions / handoff notes

- Reviewer click-through: type "em", "money", "990", "facebook" in the
  sidebar search; confirm Escape and ✕ clear; confirm clicking a result
  clears the filter; check the mobile drawer (hamburger) still works with the
  input at top.
- Copy the club may want to refine: the keyword synonym lists (pure search
  metadata, invisible in the UI) and the "No matches for ..." string.
- UX decisions: nav order is preserved under filtering (no score re-sort) so
  the menu never jumps around; keyword-only matches render the label plain
  (nothing visible to highlight); search state intentionally resets on
  navigation, matching Apple Settings behavior.
- Next: qa (Phase 5) if a formal verification pass is wanted beyond the
  implementer-run checks above; release-notes entry before push.
