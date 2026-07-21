# Admin Dashboard Applications Link — Work Log (bug-fix stub)

> **Slug:** `2026-07-21-admin-dashboard-applications-link`
> **Surface:** (dashboard) admin — dashboard "Needs Attention" chip
> **Permission(s):** none touched
> **Estimated complexity:** trivial (one href)
> **Pipeline mode:** Bug-fix variant, minimal stub — Phases 1-3 skipped (user-reported broken
> link, unambiguous fix). Phase 4 by orchestrating session; Phase 5 = gates at next push +
> user click confirmation; Phase 6 = user confirms the chip navigates.

**User report (2026-07-21):** "When I click on Pending Member Application in the Admin
Dashboard I get a 401."

**Root cause:** `src/app/(dashboard)/admin/page.tsx` linked the "Pending Member Applications"
chip to `/admin/applications`, a route that has never existed — the page shipped at
`/admin/membership`. The dead link dates to v1.3.2 (verified via `git log -S`). The
user-visible 401 (rather than 404) was the platform response to client-side navigation
against a nonexistent route during the concurrent v1.31.1 rollout; the dead link is the root
cause regardless of the status code shown.

**Fix:** chip href `/admin/applications` → `/admin/membership`. No other references to the
dead path exist in src/ (grep-verified). `/admin/membership` gates correctly (`auth()` +
`hasFeature(MEMBERSHIP_MANAGE)` page-side).

**Reproduction:** admin dashboard with ≥1 pending application → click the amber chip →
error page. Post-fix: lands on Admin → Membership.

**Related discovery:** submitting a membership application sends no notification email —
spun off as its own feature (`2026-07-21-membership-application-email.md`).

**Verification:** rides with the next push's full gate run (typecheck/tests/build); user
confirms the chip navigates post-deploy.
