# Admin Nav Highlight + Dues Filter State — Work Log

> **Slug:** `2026-07-20-admin-nav-dues-filter-fixes`
> **Surface:** (dashboard) admin — sidebar navigation; dues list/detail
> **Pipeline mode:** Bug-fix variant, both trivial — Phases 1–3 condensed (bugs confirmed by user
> report + code read; no invariants touched; root causes documented below), Phase 4–5 in main
> session, Phase 6 = user confirmation. Skips noted per CLAUDE.md.

## Bug 1 — Sidebar double-highlight on Ledger subpages

**Report:** Clicking Ledger, then Compliance or Reports, leaves "Ledger" highlighted alongside the
subpage item.

**Root cause:** `admin-sidebar.tsx` marked an item active when `pathname.startsWith(item.href + "/")`.
"Ledger" (`/admin/ledger`) is a path prefix of "Compliance" (`/admin/ledger/compliance`), "Reports",
"Donors", and "Ledger Settings", so both items matched simultaneously.

**Fix:** Compute `activeHref` = the longest matching href among visible nav items; only that item is
active. Preserves correct behavior for Ledger subpages with no nav item of their own
(`/admin/ledger/approvals`, fund detail pages still highlight "Ledger").

**Reproduction:** Visit `/admin/ledger/compliance` — pre-fix, both "Ledger" and "Compliance" render
with `bg-lions-blue`; post-fix, only "Compliance".

## Bug 2 — Dues list filter state lost on detail round-trip

**Report:** Viewing a member's dues detail and clicking "Back to Dues List" loses the list's filter.

**Root cause:** Filters (fy/status/search) live in the list URL, but the row "View" link carried only
`fy`, and the detail page's back link rebuilt `/admin/dues?fy=` from scratch — status and search were
dropped on the way in, so they couldn't come back out.

**Fix:** Row "View" links now carry `status` + `search`; the detail page accepts and threads them
into the back link and its fiscal-year selector; the list's fiscal-year selector now also preserves
`search` (it already preserved `status`).

**Reproduction:** `/admin/dues?status=unpaid` → View → Back — pre-fix lands on unfiltered list;
post-fix returns to `?status=unpaid` with the Unpaid tab active.

## Phase 5 — Verification (main session, 2026-07-20)

- `pnpm exec tsc --noEmit` PASS; `pnpm test` 313/313 PASS.
- Live verification via temporary Playwright spec (signed-in admin, deleted after run):
  - `/admin/ledger/compliance`: "Compliance" highlighted, "Ledger" not; `/admin/ledger/approvals`
    still highlights "Ledger". PASS.
  - `/admin/dues?status=unpaid` → View → detail back-link carries `status=unpaid` → Back lands on
    filtered list. PASS.
