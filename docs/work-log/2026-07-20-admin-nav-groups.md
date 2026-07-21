# Admin Sidebar Nav Groups — Work Log

> **Slug:** `2026-07-20-admin-nav-groups`
> **Surface:** (dashboard) admin
> **Permission(s):** none new — existing per-item `requiredFeature` keys reused unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 abbreviated into the task brief itself (see note below); Phase 4 (ux-developer) → Phase 5/6 skipped per task instructions (no commit requested, verification done inline)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (brief) | Done | condensed into task brief | 2026-07-20 |
| 2 — Architectural review | (brief) | Skipped | no new deps, no structural change, single-file edit | 2026-07-20 |
| 3 — Technical design | (brief) | Done | condensed into task brief (target structure, header styling, filtering rule given directly) | 2026-07-20 |
| 4 — Implementation | ux-developer | Complete | — | 2026-07-20 |
| 5 — Verification | ux-developer (self, per task instructions) | Complete | PASS | 2026-07-20 |
| 6 — Shipped vs intent | — | Not run | task explicitly scoped to abbreviated pipeline; no commit requested | — |

**Note on skips:** This was scoped by the requester as a "small UI feature — abbreviated pipeline" with Phases 1–3 condensed directly into the task brief (target grouping, exact item lists, header styling idiom, and the "always-visible headers over collapsible" decision were all pre-specified). No new permission, no schema change, no new dependency — architect review would have been a rubber stamp. Verification (typecheck, unit tests, Playwright) was performed by the implementer per explicit task instruction rather than handed to a separate qa pass.

---

# Implementation (ux-developer)

## Summary

Restructured `src/components/admin/admin-sidebar.tsx` from a single flat `navigation: NavItem[]` array into a `navigation: NavGroup[]` array (`{ label: string | null; items: NavItem[] }`). Dashboard remains a standalone entry (group with `label: null`, no header rendered). The remaining 23 items are grouped into five always-visible, non-collapsible labeled sections in this order: **People** (Members, Users, Roles, Permissions, Membership, Groups), **Treasury** (Dues, Ledger, Compliance, Reports, Donors, Ledger Settings), **Engagement** (Events, Campaigns, Announcements, Testimonials, Programs, Newsletter), **Inbox** (Contact, Suggestions), **System** (Email Queue, Sync Log, Release Notes).

## What I did

- Replaced the flat `NavItem[]` literal with a `NavGroup[]` literal, preserving every item's `name`/`href`/`icon`/`requiredFeature` exactly as it was (no icon or href changes).
- Replaced the render-time flat-list permission filter with a per-group filter: each group maps to `{ label, items: <filtered items> }`, then groups with zero visible items are dropped via `.filter((group) => group.items.length > 0)` — no orphan headers can render, including for non-admin users who lack every feature in a group.
- Rewrote the active-href computation to run over `visibleGroups.flatMap((group) => group.items)` instead of the old flat `visibleNavItems` — this keeps the "longest matching href wins" logic byte-for-byte identical, just re-scoped so it still evaluates across every visible item regardless of group.
- Added group headers: `px-3 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400`, non-link `<div>`s (not focusable, no `tabIndex`/`href`). The first labeled group (People) uses `pt-3` instead of `pt-5` — computed via `firstLabeledGroupIndex` — so the Dashboard→People transition isn't over-padded relative to the tighter `space-y-1` item rhythm.
- Left the mobile menu open/close-on-click behavior, the footer (Suggestion Box button, Back to Website link, version/release-notes link), and all existing Tailwind classes on individual items untouched.
- Did not touch `src/lib/ledger-queries.ts`, `src/lib/ledger.ts`, or `src/lib/ledger.test.ts` (flagged as concurrently owned by another agent).

## Outputs

- `src/components/admin/admin-sidebar.tsx` — restructured nav data + render logic (only file touched)
- No new dependencies, no schema changes, no new permission keys

## Verification

- `pnpm exec tsc --noEmit`: **PASS**, no errors.
- `pnpm test`: **PASS**, 327/327 tests green (no ledger-test failures attributable to this change; ledger test count is the concurrent agent's territory).
- Playwright: wrote a temporary spec `e2e/temp-admin-nav-groups.spec.ts` (not committed, deleted after use) run against the already-running dev server via `pnpm exec dotenv -e .env.local -- playwright test e2e/temp-admin-nav-groups.spec.ts --project=chromium`:
  - Test 1 (`/admin`, signed in as admin via `signInAsAdmin`): asserted all five group headers (People, Treasury, Engagement, Inbox, System) visible, and all 24 nav items (Dashboard + 23 grouped items) visible as links inside the sidebar `<nav>`. **PASS.**
  - Test 2 (`/admin/ledger/compliance`): asserted `Compliance` link carries the active (`bg-lions-blue`) class while sibling `Ledger` and `Reports` links inside the same Treasury group do not — confirms the longest-prefix-match active computation still correctly picks only the most specific match. **PASS.**
  - Screenshot taken (`test-results/admin-nav-groups.png`, deleted after review): confirms visually — Dashboard highlighted blue at top with no header above it, "PEOPLE" header directly below with tight spacing, "TREASURY" header below the People group with a visibly looser gap. Sidebar is scrollable (`overflow-y-auto`) so Engagement/Inbox/System groups are below the fold on a 1280×800 viewport, which is expected/pre-existing behavior, not a regression.
  - Both the temp spec and `test-results/` were deleted after verification, per instructions.

**Note on item count:** the task brief stated the original flat array had 22 items; the actual file (and the target grouping, which the brief itself fully enumerates) has 24 (Dashboard + 23). The Playwright spec verifies all 24 by name; this is a minor inaccuracy in the brief's count, not a functional discrepancy — the target grouping specified in the brief was followed exactly and is what's implemented.

## Implementer Notes

- Chose to keep `NavGroup.label: string | null` (rather than e.g. an optional `label?: string`) so the "no header" case for Dashboard is explicit and type-checked at every call site, matching the brief's own suggested shape.
- Chose `firstLabeledGroupIndex` (computed once per render from `visibleGroups`) over a hardcoded "index 1" assumption, so the tighter top-padding follows whichever group ends up first after permission filtering — if a non-admin user's People group were entirely filtered out, Treasury (or whichever group is first) would automatically get the tighter padding instead of leaving a gap.
- Did not add `role="heading"` or `aria-level` to the group header `<div>`s — the brief specified "not links, not focusable," and a plain muted label without heading semantics matches the existing sidebar's minimal-ARIA style (the sidebar has no other heading structure). If accessibility review later wants a landmark/heading structure here, that's a follow-up, not a regression.

## Open questions / handoff notes

- A reviewer should click through `/admin` as an admin and eyeball: Dashboard standalone at top (no header), five section headers in order (People, Treasury, Engagement, Inbox, System), correct items under each, and scroll behavior on a shorter viewport/laptop screen.
- A reviewer should also sign in as a non-admin member with a partial feature set (e.g., only `LEDGER_VIEW`) and confirm groups with zero visible items (e.g., Inbox, if they lack `CONTACT_VIEW`/`SUGGESTIONS_VIEW`) don't render an orphan header — this was verified by code inspection and the filter logic, but not click-tested live against a non-admin fixture account in this session.
- No new copy strings beyond the five section labels (People, Treasury, Engagement, Inbox, System) — these came directly from the brief, so nothing new for the Lions Club to review copy-wise.
- This work-log intentionally skips Phase 5 (qa) and Phase 6 (analyst) sign-off since the task explicitly scoped an abbreviated pipeline with no commit; if this change is later bundled into a push to `main`, run `/pre-push` first as normal.
