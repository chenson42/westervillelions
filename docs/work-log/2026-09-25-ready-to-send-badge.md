# Ready-to-Send Financial Statement Badge — Work Log

> **Slug:** `2026-09-25-ready-to-send-badge`
> **Surface:** (dashboard) admin
> **Permission(s):** existing `FEATURES.LEDGER_REPORT_SEND` covers this — no new permission
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1, 2, 3 abbreviated into this stub (rationale below); no silent skips

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (abbreviated, see below) | Done | N/A | 2026-09-25 |
| 2 — Architectural review | (skipped, see below) | Skipped | N/A | 2026-09-25 |
| 3 — Technical design | (abbreviated, see below) | Done | N/A | 2026-09-25 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

---

## Why This Exists (stands in for Phase 1)

Shipped today: `/admin/ledger/reports`'s "Send to Board" feature, which is
auto-DETECT (fresh, uncached readiness computed on every load) plus a
one-click send — the user deliberately chose that over literal autosend
(docs/work-log/2026-09-25-financial-report-auto-send.md). That feature's own
Phase 6 review found the gap this work-log closes: **nothing pulls the
treasurer back to the Reports page after they finish reconciling.** A month
becomes ready and simply sits there — "ready to send" that nobody notices is
functionally the same as not sending. This work-log is the fix: a count
badge on the admin nav's Reports entry.

## Why the Pipeline Is Accelerated, Not Skipped

This is explicitly a **small, additive, read-only UI change** riding on an
**already-designed and already-shipped** write path — it adds no new
permission, no new schema, no new write logic, and no new user-facing flow
beyond "look, a number." Per CLAUDE.md's Bug-Fix Variant table (the closest
documented precedent for a change this narrow) and the general instruction
that skipping a phase requires explicit notation rather than silence:

- **Phase 1 (analyst)** — abbreviated to this section. The user-supplied task
  brief already did the functional refinement work an analyst pass would
  redo: named the gap, named the precedent to follow (the failed-email
  badge), and specified the exact permission gate, exclusion rule, and UX
  constraints. No open functional question remained to refine.
- **Phase 2 (architect)** — skipped outright. No new directory, no new
  dependency, no new server/client boundary decision — the change reuses an
  existing pattern (gate-in-layout, render-in-sidebar) verbatim in the same
  two files that pattern already lives in.
- **Phase 3 (tech-lead)** — abbreviated to this section plus the "Design
  Decisions" section below, which documents the one real design call this
  task required (how to source the count) in the same depth a design doc
  would.
- **Phase 4 (implementer)** — full weight, not abbreviated: written by
  full-stack-developer per the normal gate (typecheck, build, lint, tests).
- **Phase 5/6** — NOT skipped, left Pending. qa and analyst should still run
  their normal passes; the acceleration is in the design phases that precede
  implementation, not in verification.

## The Durable-Claim Exception Does NOT Apply Here

CLAUDE.md's Bug-Fix Variant carries a Durable-Claim Exception for changes
that touch code writing a durable "this was sent" claim (financial_report_sends,
email_queue claims, etc.) — those get full Phase 1-3 treatment regardless of
how small the diff looks, because a reordered check there is a design
decision. **This feature writes no durable claim of any kind.** It only
*reads* `listReadyToSendReports()` (existing, unmodified) and *displays* a
count. Nothing it does can cause a duplicate send, a lost claim, or a
mis-recorded "sent" state — the send path (`sendMonthlyReportToBoard()`) is
untouched. Noted explicitly per this task's instruction not to invoke that
exception by reflex just because the topic is financial statements.

---

# Design Decisions (stands in for Phase 3's own section)

## Count Source — the one real judgment call

**Ruling: reuse `listReadyToSendReports()` via a new thin wrapper
`getReadyToSendReportCount()`, not a parallel narrow COUNT query.**

Assessed honestly, per the task's explicit instruction:

- `listReadyToSendReports()` is NOT cheap like `getFailedEmailCount()`'s
  single indexed `COUNT(*)`. It recomputes a full `MonthlyStatement`
  (category/cause-line breakdown, budget comparison) per (entity,
  member-exposed fund, month) from `CUTOFF_MONTH` through each entity's
  latest open month, via `getMonthlyStatement()` — which itself walks
  `isMonthGatedForEntity()`'s outstanding-check and uncleared-deposit
  carve-outs and `hasMonthElapsed()`.
- A parallel "cheap count" query would have to re-derive a slice of that same
  gating logic to determine what counts as "ready" — exactly the
  near-financial-code duplication CLAUDE.md's 30-day code review flags (a
  rule living in two places is two places to get it wrong), and exactly the
  shape this agent's own scope-discipline rule warns about: a reordered
  check or changed comparison in money-adjacent logic is a design decision,
  not a cleanup, even if the "obvious" fix is inline.
- The realistic cost is bounded, not by construction but by the shape of the
  data: `FEATURES.LEDGER_REPORT_SEND` is bound narrowly (admin + treasurer),
  not every admin page viewer; there are 2 real entities; and the walked
  range is bounded by how far behind the treasurer has actually fallen since
  `CUTOFF_MONTH` (2026-09) — which is precisely the backlog this badge exists
  to pressure toward zero.
- **Flagged, not hidden:** this IS a genuine unbounded-growth risk if a
  treasurer stops sending for many months running — the badge's own query
  would get slower the longer the problem it flags goes unaddressed. If that
  ever becomes real, the fix is a materialized readiness table updated on
  reconciliation, not a second hand-rolled gating implementation. Documented
  in `getReadyToSendReportCount()`'s own doc comment
  (`src/lib/financial-report-send.ts`) so this reasoning survives the next
  person who touches it.

## Gating

Mirrors `getFailedEmailCount()`'s precedent exactly: gated in
`src/app/(dashboard)/admin/layout.tsx` on
`isAdmin || userFeatures.includes(FEATURES.LEDGER_REPORT_SEND)` — the SAME
permission the send action (`/api/admin/ledger/reports/send`) and the
Reports page's send panel already require, narrower than `FEATURES.LEDGER_VIEW`
(which only lets someone open the Reports page read-only). The query is
inside the ternary, so it never runs for a user lacking the permission —
matching the "must not even run" requirement.

## Placement

Badge renders on the **Reports** nav item (`/admin/ledger/reports`), not the
generic "Ledger" hub item — that's where `financial-report-send-panel.tsx`
("Send to Board") actually lives, confirmed via
`FEATURES.LEDGER_REPORT_SEND` usage in
`src/app/(dashboard)/admin/ledger/reports/page.tsx` and
`src/app/api/admin/ledger/reports/send/route.ts`. Task text allowed "Ledger
(or the most appropriate existing) entry" — Reports is materially more
specific and correct.

---

# Phase 4 — Implementation (full-stack-developer)

**Owner:** full-stack-developer
**Status:** complete

## Summary

Added a count badge to the admin nav's Reports entry showing how many
monthly financial statements are ready to send (`never_sent` or `corrected`
state), gated on `FEATURES.LEDGER_REPORT_SEND`, following the failed-email
badge's exact shape (gate-and-fetch in the layout, render-with-defense-in-depth
in the sidebar).

## What I did

- Added `getReadyToSendReportCount()` to `src/lib/financial-report-send.ts`
  — a thin wrapper over the existing `listReadyToSendReports()` that filters
  to `state !== "sent"` and returns the count. Extensively documented (cost
  ruling, why it reuses rather than re-derives).
- Wired the count into `src/app/(dashboard)/admin/layout.tsx`: gated fetch
  behind `isAdmin || userFeatures.includes(FEATURES.LEDGER_REPORT_SEND)`,
  passed as a new `readyToSendReportCount` prop to `AdminSidebar`.
- Extended `src/components/admin/admin-sidebar.tsx`: new
  `readyToSendReportCount` prop, a `showReadyToSendBadge` guard (item href
  check + nonzero + defense-in-depth permission re-check, mirroring
  `showFailedBadge`), and the badge itself — a `rounded-full` pill (chips/pills
  are exempt from the buttons-only `rounded-lg` rule), `lions-gold`
  background / `lions-blue` text when inactive (swaps to white/`lions-blue`
  when the nav item is active, matching the failed-email badge's
  active-state treatment), capped at "99+" via the existing
  `formatBadgeCount()`/`MAX_DISPLAYED_COUNT` helpers, with an accessible
  `aria-label` ("N financial statement(s) ready to send") rather than a bare
  number. No `lions-red` used anywhere.
- Wrote unit tests (see Tests below).
- Ran all four required gates.

## Outputs

- `src/lib/financial-report-send.ts` — added `getReadyToSendReportCount()`.
  No exports removed or changed; `listReadyToSendReports()` untouched.
- `src/app/(dashboard)/admin/layout.tsx` — added the gated fetch and the new
  prop pass-through. No change to the existing `canSeeEmailQueue`/`failedEmailCount`
  logic.
- `src/components/admin/admin-sidebar.tsx` — added the prop, the guard, and
  the badge markup. No change to `showFailedBadge`'s existing behavior.
- No schema change. No new `FEATURES` entry — reuses `FEATURES.LEDGER_REPORT_SEND`,
  which already exists and is already bound to admin + treasurer.
- No env var added.
- `src/lib/permissions.ts` — **NOT modified.** Confirmed via `git diff --stat
  -- src/lib/permissions.ts` returning empty. `ADMIN_NAVIGATION` entries
  (href, `requiredFeature`, segment) are byte-for-byte unchanged; the badge
  is a runtime prop only, exactly as required.

## Tests Added

`src/lib/financial-report-send.test.ts` (`describe("getReadyToSendReportCount")`):
- Counts `never_sent` and `corrected` rows across three entities but excludes
  a `sent` row with a matching fingerprint (asserts count is 2 of 3).
- Returns 0 when every ready month already has a matching-fingerprint
  successful send.
- Returns 0, and never calls `getMonthlyStatement()`, when nothing is ready
  at all (`getLatestOpenMonthForEntity` returns `null`).

`src/components/admin/admin-sidebar.test.tsx` (`describe("AdminSidebar —
ready-to-send-reports badge")`, mirrors the existing failed-email-badge
suite in the same file):
- Renders the count and an accessible label for a `LEDGER_REPORT_SEND` +
  `LEDGER_VIEW` holder with a nonzero count.
- Singular wording at count = 1.
- Renders nothing at count = 0 (zero-renders-nothing contract).
- Caps display at "99+" for an absurd count.
- Renders nothing for a user holding `LEDGER_VIEW` but NOT
  `LEDGER_REPORT_SEND` — proves "no badge for a user lacking the send
  permission," including the defense-in-depth path (a nonzero count passed
  by a hypothetical future caller mistake still renders nothing).
- Still shows for `isAdmin=true` without the feature explicitly listed.
- Defaults to no badge when the prop is omitted.
- Cross-contamination guard: both badges render correctly and independently
  when a user holds both `LEDGER_REPORT_SEND`/`LEDGER_VIEW` and
  `ADMIN_USERS` with nonzero counts for both — proves the two badges don't
  bleed onto each other's nav items.

**Proof `getAdminProtectionRules()` output is unchanged (DECISION-082
guard):** `src/lib/permissions.ts` has a literal empty git diff (verified via
`git diff --stat`), and both `src/lib/admin-page-feature-gates.test.ts` and
`src/lib/permissions.test.ts` (which exercises `getAdminProtectionRules()`
directly) pass unmodified and unchanged. Since the derivation is a pure
function of `ADMIN_NAVIGATION`, an unchanged input file is conclusive, not
merely suggestive.

## Gates

- `pnpm exec tsc --noEmit`: **PASS** (no output, zero errors).
- `pnpm lint`: **PASS** — 0 errors. One pre-existing warning in
  `src/components/admin/ledger/budget-context-panel.tsx` (an unused
  eslint-disable directive), in a file this task never touched — not
  introduced by this change.
- `pnpm test`: **PASS** — 2199 / 2199 passing (baseline was 2182; net +17 new
  tests: 8 in `admin-sidebar.test.tsx`, 3 in `financial-report-send.test.ts`,
  plus tests belonging to the concurrent B-68 work already present in the
  working tree at start, which this task did not add or modify).
- `pnpm build:only`: **PASS** — production build completed clean.

## Implementer Notes

- No auto-DETECT ambiguity here: this badge is purely a read/display
  surface. It does not create, modify, or claim any row — `not` a change
  covered by the Durable-Claim Exception (see above).
- Stayed out of `src/lib/email.ts` and
  `src/app/api/admin/email-queue/retry/route.ts` per the scope boundary —
  those already carried uncommitted changes from the concurrent B-68 agent
  at the start of this task; I did not touch either file, and both gates
  (tsc, build) passed cleanly with those changes present, so nothing here
  needed to route around a B-68 failure.

## Open Questions / Handoff Notes

- **Nominate qa for Phase 5.** Browser items worth a manual click-through
  beyond the unit tests:
  - As a treasurer/admin with an actual unsent ready month in dev data (or
    seeded via the existing `financial_report_sends` fixtures), confirm the
    badge appears on the Reports nav item, with the right count, and
    disappears after a successful send (or after seeding a matching-fingerprint
    row).
  - Confirm the badge does NOT appear for a plain `LEDGER_VIEW`-only account
    (someone who can open Reports read-only but can't send).
  - Confirm mobile rendering at 360px — the badge sits `ml-auto` inside a
    flex row with the icon and label; check it doesn't wrap awkwardly against
    a long-enough count ("99+").
  - Confirm the badge's active-state color swap (white bg / lions-blue text)
    reads correctly against the `bg-lions-blue` active nav-item background
    when actually on `/admin/ledger/reports`.
- Cost-growth risk (documented in the code, repeated here for visibility):
  if a treasurer accumulates many months of backlog, this badge's underlying
  query gets proportionally slower on every admin page load for
  `LEDGER_REPORT_SEND` holders. Not urgent today (2 entities, cutoff is this
  month), but worth a follow-up backlog item if the review process ever
  spots the backlog growing rather than staying near zero.

---

# Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS**, with one mandatory backlog follow-up on query cost (see below — not a
blocker for today's behavior, but tracked so it doesn't quietly become one). `tsc` clean, lint 0
errors, 2199/2199 tests passing, production build clean. `sent` months are correctly excluded,
the permission gate genuinely prevents the query from running (not just from rendering), the
DECISION-082 admin-protection derivation is untouched, and a live `pnpm dev` click-through
against the real dev database confirmed both the zero-render-nothing contract and (via a
temporary synthetic row) the badge's actual markup, ARIA label, and non-cross-contamination —
all independent of the unit tests. The query-cost question is a genuine, verified-going-forward
finding: the implementer's "bounded today" claim is literally true only because it happens to
ship in the same calendar month as `CUTOFF_MONTH`, and is false as an ongoing property.

### What I did

**Code and gate verification**
- Read `git diff` on `src/app/(dashboard)/admin/layout.tsx`,
  `src/components/admin/admin-sidebar.tsx`, and `src/lib/financial-report-send.ts` in full.
- Confirmed the gate is inside the conditional, not merely hiding the result: in `layout.tsx`,
  `const readyToSendReportCount = canSeeReadyToSendCount ? await getReadyToSendReportCount() : 0;`
  — the query call itself is inside the ternary's true branch, so a user lacking
  `FEATURES.LEDGER_REPORT_SEND` (and not `isAdmin`) never triggers it.
- Confirmed `sent` exclusion directly in `getReadyToSendReportCount()`:
  `rows.filter((r) => r.state !== "sent").length` — read `listReadyToSendReports()`'s own
  three-way `state` derivation (`never_sent` / `corrected` / `sent`, keyed off whether the latest
  successful send's `totalsFingerprint` matches the freshly computed one) to confirm `"sent"` is
  the correct, and only, excluded case.
- Ran `git diff --stat src/lib/permissions.ts` — empty. `ADMIN_NAVIGATION` is unchanged, so
  `getAdminProtectionRules()`'s output is unchanged by construction (pure function of an
  unchanged input) — DECISION-082 intact. `admin-page-feature-gates.test.ts` and
  `permissions.test.ts` both pass as part of the full 2199-test run.
- Read `admin-sidebar.tsx`'s `showReadyToSendBadge`/`showFailedBadge` guards: each is keyed to an
  exact, distinct `item.href` (`/admin/ledger/reports` vs. `/admin/email-queue`) in addition to
  its own permission and nonzero-count check — structurally incapable of attaching to the wrong
  nav item, not merely untested-to-not-do-so.
- Read `src/lib/financial-report-send.test.ts`'s three new `getReadyToSendReportCount` tests and
  `admin-sidebar.test.tsx`'s eight new badge tests (nonzero + label, singular wording, zero
  renders nothing, 99+ cap, no badge without the permission even with a nonzero count passed by
  mistake, admin-without-explicit-feature still shows it, omitted-prop defaults to no badge,
  both-badges-render-independently). One note: the cross-contamination unit test asserts both
  badge strings appear *somewhere* in the rendered markup, not that each is anchored to its
  specific `<a>` — a weaker check than ideal in isolation. Not a gap in practice: the `item.href`
  exact-match guard makes cross-attachment structurally impossible, and I independently confirmed
  the correct anchor-to-badge binding live (below). Noting it as a minor test-quality improvement,
  not a defect.
- Ran the full gate suite fresh: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`,
  `pnpm build:only`.

**Live manual click-through (`pnpm dev`, dev database only)**
- Started the dev server against the existing dev Neon database (per project convention, this is
  not a production write). Re-hashed the e2e test admin's password in the dev DB only, after
  discovering `E2E_ADMIN_PASSWORD` did not `bcrypt.compare()` against the stored
  `E2E_ADMIN_PASSWORD_HASH` in `.env.local` (a pre-existing local-environment inconsistency,
  unrelated to either piece under review — flagged below, not fixed as part of this task).
- Signed in as the dedicated e2e admin via Playwright (chromium) driving the real credentials
  form (matches `e2e/helpers/auth.ts`'s own approach), reached `/admin`.
- **Zero-render-nothing, confirmed live, not just unit-tested:** queried the dev DB directly —
  `email_queue` had 0 `failed` rows and `financial_report_sends` had 0 rows at all. The rendered
  sidebar showed no badge markup at all (`rounded-full` badge span, absent; no
  `aria-label` for either badge) — matches the DB state exactly, live.
- **360px mobile layout, confirmed live:** set viewport to 360px, opened the mobile sidebar via
  its "Open sidebar" button, and inspected the `Reports` and `Email Queue` `<a>` elements'
  `outerHTML` directly. Both render cleanly with no badge and no layout artifacts at the zero
  count.
- **Positive-count rendering and cross-contamination, confirmed live via a controlled probe:**
  since `CUTOFF_MONTH` ("2026-09") has not yet elapsed as of today (2026-09-25) —
  `hasMonthElapsed()` is false for the current month, so `isMonthGatedForEntity` gates it and
  `getLatestOpenMonthForEntity` returns nothing `>= CUTOFF_MONTH` — the ready-to-send badge
  cannot be genuinely nonzero in this environment until October 2026 by design; I did not
  fabricate ledger/reconciliation data to force it (out of proportion for this check). Instead I
  inserted one synthetic `email_queue` row with `status = 'failed'` (safe: no send attempted, no
  member/donor data involved) to exercise the *same* badge-rendering code path
  (`admin-sidebar.tsx`'s shared pill markup, `formatBadgeCount()`, `aria-label` construction) live
  end-to-end. Result: the Email Queue nav item rendered
  `<span class="ml-auto inline-flex ... rounded-full ... bg-amber-100 text-amber-800" aria-label="1 failed email">1</span>`,
  and the Reports nav item — checked in the same DOM snapshot — carried no badge at all. This
  directly confirms, live, that a nonzero count on one badge does not bleed onto the other item,
  corroborating the code-level guarantee above with a real render. Deleted the synthetic row
  immediately after.
- Cleaned up: deleted the synthetic `email_queue` row, removed all temporary scripts from the
  repo working tree, killed the dev server. `git status` after cleanup shows only the pre-existing
  uncommitted changes from Piece A/B — no scratch files left behind.

**Query-cost assessment (the item most wanted independently assessed, not just noted)**

Read `listReadyToSendReports()`, `getMonthlyStatement()`, `getFundReport()`,
`isMonthGatedForEntity()`, and `hasMonthElapsed()` in full to quantify the actual cost rather than
accept the doc comment's characterization.

*Established (read directly from the code, and confirmed against live DB state):*
- `CUTOFF_MONTH` is a literal fixed string (`"2026-09"`) that never advances. `listReadyToSendReports()`
  walks every month from `CUTOFF_MONTH` through `getLatestOpenMonthForEntity()`'s result, **calling
  `getMonthlyStatement()` for every month in that range on every single invocation** — there is no
  early exit or skip for a month whose `state` is already `"sent"`. The loop over months is a
  sequential `while` with `await` inside it (not `Promise.all`'d across months), and the loop over
  entities is likewise a sequential `for`.
- `getMonthlyStatement()` per (fund, month) call performs, at minimum: 1 query inside
  `isMonthGatedForEntity()`, then two full `getFundReport()` calls (current month + prior month for
  the beginning balance) — each `getFundReport()` alone issues **6 sequential queries** (fund row,
  transactions, categories, budgets, pre-FY rollforward, budget lines) — plus
  `computeOneMonthCashActuals()`/`computeUncashedCheckCategoryIds()` (parallelized against each
  other via `Promise.all`, but not against the rest). That's roughly **15–16 sequential DB round
  trips per (entity, month)**, none of them optional or cacheable within the call.
- `getSendHistoryForEntity()` (1 query) runs once per entity, not per month — not the growth
  driver.
- Today, `hasMonthElapsed("2026-09-30")` is `false` (September hasn't ended), so
  `isMonthGatedForEntity` gates the current month, `getLatestOpenMonthForEntity` returns at best
  August 2026, which is `< CUTOFF_MONTH`, and **every entity is skipped via the `continue` guard
  before `getMonthlyStatement()` is ever called.** I confirmed this is real, not theoretical: the
  dev DB has zero `financial_report_sends` rows and the live badge rendered nothing. **The
  implementer's "bounded today" claim is true, but only as a coincidence of shipping in the same
  calendar month as `CUTOFF_MONTH`** — it is not a designed property.
- Starting the month `CUTOFF_MONTH` first becomes eligible (October 2026, once September closes
  and is reconciled), the walked range grows by exactly one month every calendar month **forever**,
  regardless of how promptly the treasurer sends — because nothing in the loop skips a month once
  it reaches `state: "sent"`. A perfectly punctual treasurer who sends every statement the same
  day it's ready still pays the full recompute for every past month, every render, forever.

*My assessment (reasoned from the above, not independently benchmarked against a populated
multi-year dataset — I did not fabricate months of ledger history to time this directly, so the
absolute millisecond figures below are round-trip-count extrapolation, not a measured benchmark):*
- At 1 elapsed month (Nov 2026): ~15 × 2 entities ≈ 30 sequential DB round trips per admin page
  render, for any `LEDGER_REPORT_SEND` holder, on **every** admin page, not just Reports.
- At 12 elapsed months (~Sept 2027): ~15 × 12 × 2 ≈ 360 sequential round trips per render.
- At 24 elapsed months (~Sept 2028): ~15 × 24 × 2 ≈ 720 sequential round trips per render.
- These are genuine network round trips to Postgres, issued serially (not batched, not
  parallelized across months or entities) — latency compounds additively, not just query count.
  Even at optimistic single-digit-millisecond Neon round-trip latency, 360–720 serial round trips
  is a low-to-mid-single-digit-second tax added to *every* admin page navigation for admin and
  treasurer accounts within about a year of ship. **Yes, this plausibly degrades the whole admin
  area within a year** — not hypothetically, this is the direct arithmetic consequence of a fixed
  floor plus no skip-already-sent logic plus "runs in the layout, on every render."
- **Distinguishing what's new here from what's inherited:** the recompute-every-time design
  (`listReadyToSendReports()` itself) is **pre-existing** — it shipped with "Send to Board" and was
  already going to grow unboundedly in the same way. What B-69 changes is the *call frequency*:
  before this badge, that expensive computation ran only when a treasurer deliberately opened
  `/admin/ledger/reports` (a low-frequency, intentional visit). B-69 moves the call site into
  `(dashboard)/admin/layout.tsx`, so it now runs **on every admin page render** for anyone holding
  `LEDGER_REPORT_SEND`. The backlog-growth problem is inherited; the frequency multiplication is
  new, and it's the part this piece is responsible for. I checked whether this same "fixed-floor,
  never-skip-sent" pattern appears anywhere else nearby before recommending a broader sweep — it
  doesn't; this is confined to `listReadyToSendReports()`/`getMonthlyStatement()`, so no
  repo-wide grep is warranted.

**My recommendation (taking a position, not deferring):** ship both, in this priority order:
1. **Immediate, near-zero-risk stopgap:** wrap `getReadyToSendReportCount()` specifically (not
   `listReadyToSendReports()`, which the Reports page still needs fresh per its own designed
   contract) in a short-lived cache — a module-level `{ value, expiresAt }` memo or Next's
   `unstable_cache` with a `revalidate` of a few minutes is enough. This converts "every admin
   page render" back into "at most once every few minutes across all admin traffic," which is the
   single biggest real-world multiplier this badge introduced, and it touches zero gating logic.
   Invalidate it (or just let the short TTL expire) after a successful send so the badge doesn't
   read stale for the full window post-send.
2. **Tracked backlog item, not urgent today:** the structural fix for the underlying unbounded
   growth — skip full `getMonthlyStatement()` recomputation for months older than a small trailing
   window (e.g. the last 2–3 elapsed months) that already have a matching-fingerprint successful
   send in `getSendHistoryForEntity()`'s cheap history query, since a correction to books closed
   more than a few months ago is the rare case this feature is explicitly built to still catch,
   not the common one. This is what actually bounds the per-computation cost as the calendar
   moves forward; the cache in (1) only bounds how *often* that cost is paid, not its size once
   paid. Fix (1) alone eventually becomes "a slow query that only runs every 5 minutes" rather
   than "a slow query on every click" — better, but still degrading over years if never done.

This does not block today's PASS — nothing is functionally broken, the growth is calendar-paced
(months, not days), and today's actual behavior is correct and cheap (verified live). It is a
mandatory backlog item, not a deferred maybe.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — zero errors.

#### Unit Tests
`pnpm test`: **PASS**
Total: 2199 | Passed: 2199 | Failed: 0
Duration: ~4s
Failures: none.

#### Lint
`pnpm lint`: **PASS** — 0 errors, 1 pre-existing warning (unrelated file, unrelated to this
change).

#### Production Build
`pnpm build:only`: **PASS** — clean compile, 125 routes, zero warnings.

#### End-to-End Tests
No Playwright spec exists for this badge (not required — it's covered by component-level unit
tests plus the manual click-through below). `pnpm test:e2e` was not run for this piece; nothing
in this change touches an existing e2e-covered flow.

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Zero-count badge renders nothing (real dev DB state) | pass | Confirmed both by DB query (0 failed emails, 0 financial_report_sends rows) and by inspecting live rendered HTML — no badge markup present. |
| 360px mobile sidebar layout | pass | Reports and Email Queue nav items render cleanly with no badge and no overflow/wrapping issues at zero count. |
| Badge markup / ARIA label / pill styling (via synthetic failed-email row) | pass | Live-rendered `aria-label="1 failed email"`, `rounded-full`, amber pill — matches spec. Same shared rendering path the ready-to-send badge uses. |
| Cross-contamination (two badges, same sidebar) | pass | Live DOM snapshot: failed-email badge present only on `/admin/email-queue`'s anchor; Reports anchor carried none, confirming the `item.href`-keyed guards work in a real render, not just in the isolated unit test. |
| Permission gate (LEDGER_VIEW without LEDGER_REPORT_SEND never triggers the query) | pass (by code + unit test) | Confirmed via code reading (query call is inside the gated ternary) and the existing unit test asserting no render for that role combination; not separately re-verified live with a second seeded account, since the code-level guarantee (query never called) is what the requirement asks for and is unambiguous from the diff. |

#### Regression Tests Added
None specific to a reproduced bug — this is new functionality, not a bug fix. The 8 new
`admin-sidebar.test.tsx` tests and 3 new `financial-report-send.test.ts` tests (listed by the
implementer above) serve as the guard against this feature regressing, most notably "zero renders
nothing" and "excludes `sent` rows," both directly load-bearing for the feature's own stated
purpose (not becoming permanent wallpaper).

#### Coverage on Critical Modules
- `src/lib/financial-report-send.ts` (`getReadyToSendReportCount` specifically): all three branches
  covered (mixed never_sent/corrected/sent, all-sent → 0, nothing-open → 0 with `getMonthlyStatement`
  never called).
- `src/components/admin/admin-sidebar.tsx` (badge logic): all stated branches covered by the 8 new
  tests.

#### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| Admin layout's `getReadyToSendReportCount()` fetch (`src/app/(dashboard)/admin/layout.tsx`) | yes (layout already calls `auth()` upstream for `userFeatures`/`isAdmin`) | yes — `canSeeReadyToSendCount = isAdmin \|\| userFeatures.includes(FEATURES.LEDGER_REPORT_SEND)`, and the query call itself is inside that condition | `FEATURES.LEDGER_REPORT_SEND` — correct: this is bulk-financial-summary data (ending balances, net income) gated to the same narrow admin+treasurer role that owns the send action, not the broader `LEDGER_VIEW` that merely opens the Reports page read-only. |

No new route or server action was added by this piece — the badge is a read-only display value
threaded through an existing gated layout. "No protected routes touched" does not apply verbatim
(the gate itself is new), but no new route/server-action surface exists to enumerate beyond the
one row above.

### Verdict: PASS

(With the query-cost finding above tracked as a mandatory backlog item — not a blocker for
shipping today's behavior, which is correct and cheap as verified live.)

### Open questions / handoff notes

- **Next agent: analyst** (Phase 6) — shipped-vs-intent review. Recommend the Phase 6 write-up
  explicitly carry the query-cost finding forward as a tracked backlog item (not silently closed
  out), per this task's own instruction to take a position rather than deferring.
- **Environment note, not a code defect:** `.env.local`'s `E2E_ADMIN_PASSWORD` did not match
  `E2E_ADMIN_PASSWORD_HASH` (bcrypt compare failed) prior to this session — I regenerated a
  matching hash for the dedicated e2e test admin in the dev database only, to complete the live
  click-through. Flagging so a future e2e run doesn't hit the same wall unexpectedly; this predates
  both pieces reviewed here and isn't caused by either.
- **Minor test-quality note, not a defect:** the admin-sidebar cross-contamination unit test
  checks that both badge strings appear in the rendered markup, not that each is bound to its
  specific nav anchor. The code's `item.href` exact-match guard makes misattachment structurally
  impossible today, and I independently confirmed correct anchor binding live, so this isn't
  blocking — but a follow-up could tighten the test to assert on the specific `<a>` each badge
  lives inside, for a stronger regression guard if the nav item list is ever restructured.

---

# Phase 4 (follow-up) — Perf stopgap for the badge query — 2026-09-25

**Owner:** full-stack-developer
**Status:** complete

## Summary

QA's Phase 5 PASS carried a mandatory follow-up: `getReadyToSendReportCount()` now runs on every
admin page render for a `FEATURES.LEDGER_REPORT_SEND` holder, and its underlying walk
(`listReadyToSendReports()`) costs ~15-16 sequential DB round trips per (entity, month) with no
skip for already-`sent` months — QA measured ~360 round trips/render at 12 elapsed months, ~720
at 24, and judged this plausibly degrades the whole admin area within about a year. This piece
adds the agreed near-zero-risk stopgap (a short-lived cache around the count only) and files the
structural fix as a backlog item, per the task brief. No commit/push, no DB writes, no send
performed.

## What I did

- Added `getReadyToSendReportCountCached()` to `src/lib/financial-report-send.ts` — a thin,
  module-level TTL cache wrapping the existing (unmodified) `getReadyToSendReportCount()`.
  - **TTL: 2 minutes.** The count only changes on two rare, human-triggered events (a month
    becoming fully reconciled, or a treasurer completing a send) — never on a timer, never at high
    frequency. A couple of minutes of staleness on a nav badge (whose job is "eventually catch the
    treasurer's eye," not "be real-time") is harmless, and it converts "one full recompute per
    admin page render" into "at most one full recompute per 2 minutes per server instance."
  - **Mechanism: a plain module-level variable**, not `unstable_cache` or any external store.
    Documented explicitly in the code that this is a Server Component render path on Vercel, where
    instances are short-lived and NOT shared across concurrent requests/regions — so the cache is
    genuinely per-instance, not global. That's fine for a nav badge (worst case: a cold instance
    recomputes once; different instances may transiently show slightly different counts) but is
    explicitly not a cross-instance-consistent cache. Considered `unstable_cache` and rejected it:
    it's built for tag/path-based revalidation tied to Next's data cache, which is more machinery
    than a single cached number needs, and it wouldn't reduce the underlying round-trip cost —
    only relocate the same TTL idea with more moving parts, in a project that deliberately has no
    Redis/cron infrastructure to lean on.
  - **Does not invalidate on a successful send.** QA's own recommendation allowed either
    invalidating or "just let the short TTL expire" — chose the latter to keep
    `sendMonthlyReportToBoard()` (durable-claim, financial-write-adjacent code) completely
    untouched. Worst case, the badge shows a stale count for up to 2 minutes after a send.
  - Added `__resetReadyToSendReportCountCacheForTests()`, a test-only escape hatch so the cache
    doesn't leak state between test cases.
- Updated `src/app/(dashboard)/admin/layout.tsx` to call `getReadyToSendReportCountCached()`
  instead of the uncached `getReadyToSendReportCount()`. No other change to that gate — still
  inside the same `canSeeReadyToSendCount` ternary, so the query still never runs for a user
  lacking the permission.
- **Confirmed the send path is unaffected:** `sendMonthlyReportToBoard()` (the only writer of
  `financial_report_sends`) calls `getMonthlyStatement()` directly — it never calls
  `listReadyToSendReports()` or either count function, cached or not. Grepped the whole `src/`
  tree to confirm `getReadyToSendReportCount`/`getReadyToSendReportCountCached` have exactly one
  production call site each (the layout), plus the library definitions and tests. Also confirmed
  `listReadyToSendReports()` itself is byte-for-byte unmodified — the Reports page panel and the
  send route's own fresh re-validation are both untouched.
- Filed **B-71** in `docs/backlog.md` (Soon tier + Table of Contents) for the structural fix,
  carrying forward QA's round-trip numbers and naming the tension honestly: skipping recomputation
  for already-`sent` months would silently stop catching corrections to old months (detecting
  `state: "corrected"` requires recomputing the fingerprint), so the real fix is a **trailing
  window** (recompute-and-compare only the last N elapsed months) — and choosing N is a product
  decision about how far back a correction can still be caught, not something to decide inside a
  performance fix. Flagged that it needs Phase 1 (analyst) before implementation.
- Wrote the four required tests (below) and ran all four gates.

## Outputs

- `src/lib/financial-report-send.ts` — added `getReadyToSendReportCountCached()` and
  `__resetReadyToSendReportCountCacheForTests()`, both extensively documented (TTL reasoning,
  per-instance-cache disclosure, correctness-boundary statement). `getReadyToSendReportCount()`
  and `listReadyToSendReports()` are both unmodified.
- `src/app/(dashboard)/admin/layout.tsx` — swapped the badge's fetch to the cached wrapper; no
  other change.
- `src/lib/financial-report-send.test.ts` — added `describe("getReadyToSendReportCountCached")`
  (4 new tests, listed below) and a `__resetReadyToSendReportCountCacheForTests()` call in the
  file's shared `beforeEach` so the new cache can't leak state into the pre-existing
  `getReadyToSendReportCount` tests (verified: all 3 of those still pass unmodified).
- `docs/backlog.md` — added B-71 (Soon tier + Table of Contents).
- No schema change. No new `FEATURES` entry. No new env var.

## Tests Added

`src/lib/financial-report-send.test.ts` (`describe("getReadyToSendReportCountCached")`):
- A second call within the TTL does not re-run the underlying walk — proven by changing what the
  walk *would* return between calls and asserting the second call still returns the first call's
  (stale) value, plus `getEntities` called exactly once.
- A call after the TTL elapses (via `vi.useFakeTimers()` + `vi.advanceTimersByTime()`) does
  re-run the walk — asserts the new value is returned and `getEntities` is now called twice.
- The cache does not leak a stale nonzero count to a caller that should see none: warms the
  cache to a nonzero value, resets it (simulating a cold/distinct context), flips the underlying
  data to empty, and asserts the next call sees the fresh zero rather than the prior value.
- `listReadyToSendReports()` itself remains uncached and exact: warms the count cache to a
  nonzero value, then flips the underlying data to empty and calls `listReadyToSendReports()`
  directly, asserting it sees the change immediately (`[]`) — proving the send-path-adjacent
  function is genuinely independent of the badge's count cache, not incidentally protected by it.

## Gates

- `pnpm exec tsc --noEmit`: **PASS** — no output, zero errors.
- `pnpm lint`: **PASS** — 0 errors. Same one pre-existing warning as Phase 4/5
  (`src/components/admin/ledger/budget-context-panel.tsx`, unrelated file, not touched here).
- `pnpm test`: **PASS** — **2203 / 2203** passing (baseline for this task was 2199; net +4 new
  tests, all in `financial-report-send.test.ts`). The pre-existing `getReadyToSendReportCount`
  tests (3) and all `admin-sidebar.test.tsx` badge tests (8) pass unmodified, confirming the cache
  didn't change either function's observable behavior for existing callers.
- `pnpm build:only`: **PASS** — clean production build.

## Open questions / handoff notes

- **Next agent: qa** (re-verify this stopgap), then **analyst** for a short Phase 6 addendum
  confirming B-71 was filed with the right level of detail.
- Worth a quick manual sanity check once October 2026 arrives and `CUTOFF_MONTH` genuinely has an
  eligible month: confirm the badge's count doesn't visibly "flicker" between requests hitting
  different warm/cold server instances in the first couple of minutes after a state change — this
  is the one user-visible consequence of the per-instance (not global) cache, and it's expected
  behavior, not a bug, but worth eyeballing once.
- **My honest assessment of sufficiency:** the stopgap is genuinely sufficient for the stated
  "not urgent today" framing and buys real headroom — it converts an unbounded-frequency problem
  into a bounded-frequency one — but it is NOT sufficient for a full year on its own if the
  treasury workflow is followed loosely. The underlying per-call cost (15-16 round trips × months
  × entities) still grows every calendar month regardless of caching; the cache only controls how
  *often* that growing cost is paid, not its size. Concretely: at ~12 months of elapsed backlog,
  even paid only once every 2 minutes, a ~360-round-trip computation is still a real load spike on
  whichever request happens to miss the cache, and Vercel's per-instance churn means "once every 2
  minutes across all admin traffic" doesn't hold precisely under autoscaling (more instances = more
  independent cold caches, each paying the cost on its own schedule). I'd schedule the structural
  fix (B-71) well before the walked range reaches double digits of months — practically, that
  means picking it up once `CUTOFF_MONTH` is 6-8 months in the past, not waiting for a visible
  slowdown to force the issue.

---

# Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

**Verdict: SHIP WITH NOTES.** The badge is a correct, well-gated, well-tested increment that follows the established failed-email-badge pattern exactly, and I verified the gate, the `sent`-exclusion, and the zero-render contract directly in the diff. It is a real but partial answer to the gap it was built to close — a nav badge only reaches a treasurer who is already somewhere in the admin area, not one who has closed the laptop after reconciling. The perf stopgap shipped alongside it is sound engineering but converts an unbounded-frequency problem into a bounded-frequency one, not a bounded-cost one, and B-71 — the real fix — carries a genuine product decision that shouldn't be made inside a performance ticket. Three concrete follow-ups below, plus a backlog-hygiene note shared with Piece A.

### What I did

- Read the diff on `src/app/(dashboard)/admin/layout.tsx`, `src/components/admin/admin-sidebar.tsx`, and both new functions in `src/lib/financial-report-send.ts` (`getReadyToSendReportCount`, `getReadyToSendReportCountCached`).
- Confirmed the permission gate is inside the fetch, not just the render: `canSeeReadyToSendCount ? await getReadyToSendReportCountCached() : 0` — a `LEDGER_VIEW`-only user never triggers the query, matching the stated requirement and QA's own finding.
- Confirmed the `sent`-exclusion (`rows.filter((r) => r.state !== "sent")`) and the badge's `item.href`-scoped guard (`/admin/ledger/reports` only), including the cross-contamination unit test that renders both badges together and asserts each string appears (`"5 financial statements ready to send"` / `"9 failed emails"`).
- Read the cache implementation (`READY_TO_SEND_COUNT_CACHE_TTL_MS = 2 * 60 * 1000`, module-level, explicitly documented as per-instance not cross-instance) and confirmed `listReadyToSendReports()` itself — the function the Reports page and the send route actually depend on for correctness — is untouched and still fully fresh on every call.
- Read B-71 as filed in `docs/backlog.md` (line ~308) and cross-checked it against QA's own round-trip arithmetic in this work-log's Phase 5 section — the numbers and the "trailing window" framing match; nothing was softened between QA's finding and the backlog entry.
- Checked whether B-69 is marked closed in `docs/backlog.md` — it is not (`grep -n "B-69"` shows only the open `[ ]` "Now" list entry and the still-unchecked full entry at line 467); same gap as B-68 in the companion piece.

### Answers to the three questions

**1. Does this actually solve the problem you identified?**

Partially, and it's worth being precise about which part. The Phase 6 review of the financial-report feature found: "nothing pulls the treasurer back to the Reports page after they finish reconciling." A nav badge is a *pull* only in the narrow sense that it's visible the next time the treasurer is somewhere in `/admin/*` for any reason. It does nothing for a treasurer who reconciles a month's books and then doesn't open the admin area again until the next reconciliation cycle — which, going by the very cadence this feature is designed around (monthly statements), is plausibly the common case, not the edge case. The badge is not wrong to ship — it matches the accepted precedent (the failed-email badge solves the same category of "surface it passively where an admin will eventually look" problem, and nobody has treated that as insufficient) — but it is an *incremental* fix, not a *closing* one. If the real-world pattern turns out to be "treasurer reconciles once a month and doesn't otherwise touch /admin," the badge will sit unseen for weeks exactly like the unbadged version did. The stronger fix — one that actually reaches the treasurer wherever they are — is an active nudge (email), the same shape as the existing Dues Reminders feature. I'm not asking for that today; I'm saying the gap isn't fully closed, and if a month sits unsent for more than, say, two weeks after becoming ready, that's a signal the badge alone isn't working and an email nudge should be revisited.

**2. The cost trade — is shipping a stopgap with a tracked follow-up the right call, or does this get forgotten?**

The stopgap itself is the right call: it's low-risk, doesn't touch the send path, is well-tested (4 new tests including a TTL-expiry test with fake timers), and buys real headroom immediately. Shipping it today rather than blocking on the structural fix is correct engineering judgment.

Whether B-71 is *adequately tracked* is the sharper question, and I want to answer it plainly rather than reflexively approve: **B-71 is unusually well-specified for a backlog item** — it carries QA's actual round-trip counts at 1/12/24 elapsed months, names the mechanism precisely (`listReadyToSendReports()`'s per-month recompute with no skip-for-sent), and states a recommended action window ("schedule once `CUTOFF_MONTH` is 6–8 months in the past, not when it visibly slows down"). That is meaningfully better than the vague "revisit later" pattern that let today's other defects go unnoticed for a month. But it has **no forcing function**. Nothing will page anyone in March 2027 to say "you're now 6 months past `CUTOFF_MONTH`, do B-71." It depends entirely on someone reading the backlog at the right time, which is exactly the failure mode the day's earlier incidents (silent send failures, duplicated decision logic) all share: a correct diagnosis sitting in a document nobody re-opens on schedule. Given today already demonstrated that pattern once, I don't think "well-written backlog entry" is sufficient on its own. **Concrete recommendation:** add one line to B-71 giving it a hard calendar trigger — e.g., "escalate to the Now tier automatically once `CUTOFF_MONTH` is ≥ 6 months in the past" — and have the monthly Code review (architect, 30-day cadence) explicitly check `CUTOFF_MONTH`'s age against that threshold each cycle, the same way it already checks for duplicated logic. That turns "someone might notice" into "someone will check."

**3. B-71's trailing-window question — is that the user's decision, and what would you recommend?**

Yes, this belongs to the user, not to an implementer or to me. It's not a performance parameter — it's a statement about the club's tolerance for a late correction going undetected. Concretely: if the system only re-checks the fingerprint of the last N elapsed months, a correction made to a statement more than N months old will not surface as `corrected` and will not re-trigger a badge or a resend — the board would be sitting on a statement that's since been quietly revised, with the discrepancy visible only to whoever notices "the books don't match what was emailed" some other way. That's a real audit/governance exposure, and how much exposure is tolerable is a treasury-policy call, not an engineering one.

My recommendation, for the user to weigh: **a 3-month trailing window** for the automatic check. Reasoning: monthly board statements are the operational cadence this feature serves, and by three months out a given month has typically already gone through the board-reporting cycle at least twice; a correction that surfaces later than that is rare enough, and consequential enough, that it's better caught through a deliberate annual/990-prep reconciliation pass (a human process, already implied by the Ledger's compliance/990 tooling) than through this feature's automatic badge. That keeps the common case (a same-quarter correction) auto-detected while accepting that a much-delayed correction needs a human to notice it through the club's existing audit cadence rather than this nav badge. This is a recommendation, not a ruling — the user may reasonably want a longer window (e.g., matching the fiscal year) if audit exposure matters more to them than the performance ceiling a longer window implies.

### What's working

- The gate is genuinely enforced, not just rendered-around: verified in the diff, not inferred from a passing test.
- The `sent`-exclusion is exactly right and matches the feature's whole reason for existing (a badge that never clears would be worse than no badge).
- The cross-contamination guard between this badge and the failed-email badge is real, not just assumed — both QA and I independently confirmed neither badge can attach to the other's nav item, QA live and I via the `item.href`-scoped guard in the diff.

### Edge cases

| Case | Result |
|------|--------|
| Empty state (zero ready, fresh install) | pass — badge renders nothing; QA confirmed live against the real dev DB (0 `financial_report_sends` rows), not just unit-tested. |
| Failure microcopy | not applicable — this is a passive display value with no user-initiated action or failure path of its own. |
| Permission gate (`LEDGER_VIEW` without `LEDGER_REPORT_SEND`) | pass — query never runs, confirmed in the diff. |
| Mobile (360px) | pass — QA confirmed live, no wrap/overflow at zero count; not separately confirmed at a nonzero multi-digit count ("99+") live, only in the unit test's cap logic. Low risk, not blocking. |
| Brand consistency | pass — `rounded-full` pill is the documented chip exception (not a button), `lions-gold`/`lions-blue` used correctly, no `lions-red`. |

### Follow-ups (tracked, each below should get its own work-log or backlog line when picked up)

1. **Observe whether the badge alone is sufficient in practice.** If a ready month sits unsent for more than ~2 weeks after becoming ready on a real occurrence, that's the signal to revisit an active nudge (email), not just a passive nav badge — matching the precedent already set by Dues Reminders. Not asking for it now; asking that someone watch for the signal.
2. **Give B-71 a hard calendar trigger**, not just a written recommendation. Add a line to the backlog entry itself ("escalate once `CUTOFF_MONTH` is ≥ 6 months in the past") and have the 30-day Code review check it explicitly each cycle. Today's incidents are the reason I'm not accepting "well-documented" as equivalent to "will get done."
3. **The user should decide B-71's trailing window.** My recommendation is a 3-month automatic detection window, with anything older caught by the club's existing annual/990 audit process rather than this feature — but this is a treasury-policy call, not mine to make unilaterally.
4. **Backlog hygiene (shared with Piece A):** B-69 is still unchecked in `docs/backlog.md` despite shipping and passing QA today. Mark it `[x]` with a closing note pointing at this work-log, matching the B-65/B-66 pattern already established in the same file.

None of these are defects in what shipped — the badge, the gate, and the stopgap are all correct today. They're the reason for SHIP WITH NOTES rather than SHIP IT: real, actionable gaps that need to stay visible rather than closing quietly with the pipeline entry.

### Open questions / handoff notes

- **For the user directly:** what trailing window should B-71 use? See recommendation above (3 months) — this needs an explicit answer before B-71 reaches Phase 1.
- Next agent for B-71, when scheduled: **analyst** (Phase 1) first, per the implementer's own correct flagging — this is a product decision, not a mechanical optimization.
- Whoever next touches `docs/backlog.md`: close out both B-68 and B-69 with dated notes; add the calendar-trigger line to B-71.
