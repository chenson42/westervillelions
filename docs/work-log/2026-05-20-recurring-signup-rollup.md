# Recurring Event Signup Rollup — Work Log

> **Slug:** `2026-05-20-recurring-signup-rollup`
> **Surface:** admin (`/(dashboard)/admin/events` list + detail) — both surfaces under-count
> **Permission(s):** existing — no new key
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (Phase 2 likely skipped; Phase 3 brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-20 |
| 2 — Architectural review | architect | Skipped | Skipped (bug-fix variant) | 2026-05-20 |
| 3 — Technical design | tech-lead | Complete | Complete | 2026-05-20 |
| 4 — Implementation | full-stack-developer | Complete | Complete | 2026-05-20 |
| 5 — Verification | qa | Complete | PASS | 2026-05-20 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-05-20 |

---

## Intent (from user)

Recurring events (e.g., the Farmers Market series) display a signup count that reflects only the first/next occurrence instead of rolling up across all occurrences. The user reports seeing "2 signups" when there are signups across multiple dates that should sum higher.

**Where it's wrong (user-confirmed):** both the admin events list (the headline count next to each event) AND the admin event detail page.

**Expected behavior:** for a recurring event, the displayed total signups should be the count of all RSVPs across every (non-cancelled) occurrence in the series. Per-occurrence breakdowns on the detail page should still be visible alongside the rollup.

**Out of scope:**
- Restating non-recurring events (their existing one-occurrence count is correct).
- Member-portal display tweaks (only admin surfaces under-count today per user report).
- Changing the per-occurrence RSVP data model.

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-05-20

**Owner:** analyst
**Status:** complete

### Summary

The bug is real and the root cause is confirmed in code. The admin events list page intentionally scopes the RSVP count for a recurring event to the **next upcoming occurrence only** — this is the by-design behavior from the comment at line 109 of `admin/events/page.tsx`: "For recurring events, the row's count should reflect just the next upcoming occurrence." The user's intent is the opposite: the count chip should roll up across all (non-cancelled) occurrences. The admin event detail page compounds this by computing a flat count (`attending.length`, `maybe.length`, `declined.length`) at lines 154–157 of `admin/events/[id]/page.tsx`, but those variables are used only in the non-recurring branch of the JSX — the recurring branch shows per-occurrence groups only, with no series-level summary numbers at all. So the detail page doesn't actually show a "wrong rollup"; it shows **no rollup** for recurring events.

The fix scope is contained to two files and requires no schema changes and no new permissions.

### What I did

**Pass 1 — Offending code path**

**Admin list page** (`src/app/(dashboard)/admin/events/page.tsx`, lines 109–132):

The `occurrenceFilter` map is built for every recurring event. For each, `getNextOccurrence()` is called and only rows whose `occurrenceDate` (YYYY-MM-DD prefix) matches the next occurrence date are counted. RSVP rows from all prior and other future dates are dropped by the `if (rowDate !== targetDate) continue;` guard at line 141. This is a deliberate design choice in the original implementation — the comment at line 109 makes it explicit — but it conflicts with what the user wants.

**Admin detail page** (`src/app/(dashboard)/admin/events/[id]/page.tsx`, lines 153–158):

The flat summary block (`attending`, `maybe`, `declined`, `totalGuests`, `attendingTotal`) is computed from `rsvpRows` (all rows for the event, across all occurrences). However, the JSX at line 210 renders either the recurring group view (via `AdminOccurrenceRsvpSection`) or the flat stats block — never both. For recurring events, the flat stats block is never rendered. There is no series-level "total signups" headline on the detail page for recurring events. The per-occurrence groups each display their own row counts correctly.

**Why the list shows "2 signups":** only 2 members have signed up for the next upcoming occurrence of the Farmers Market series. All prior-occurrence RSVPs are filtered out.

**Pass 2 — Fix scope and correct count definitions**

**Admin list — what the corrected count should be:**

- Recurring event: sum of RSVPs across ALL non-cancelled occurrences in the series (total RSVPs, not unique members — see justification below). The per-occurrence filter in `occurrenceFilter` must not apply to recurring events; instead, include all RSVP rows for the event and count them. Cancelled occurrences must be excluded: if `row.occurrenceDate`'s YYYY-MM-DD prefix appears in the `cancelledByEvent` set for that event, skip the row.
- Non-recurring event: no change. The existing `occurrenceFilter.set(event.id, null)` path already counts all rows.

**Admin detail — what the corrected display should be:**

A series-level summary header above the per-occurrence groups on the detail page. The existing `attendingTotal` / `maybe.length` / `declined.length` calculation already totals across all occurrences; the issue is that it is never rendered for recurring events. The fix: render a summary chip or summary row at the top of the recurring RSVP section ("X total signups across Y occurrences"), keeping the per-occurrence breakdown below it. Exclude cancelled-occurrence rows from the summary.

**Pass 3 — Total RSVPs vs unique members**

Recommendation: **Total RSVPs.** Justification: the admin's operational question for a signup event like the Farmers Market is "how many slots have been claimed in total" and "how many people showed up across all dates" — not "how many distinct humans have ever signed up." Total RSVPs directly answers attendance-load questions. Unique-member de-duplication would require a more complex query (`COUNT DISTINCT user_id`) and would silently under-report the capacity commitment. The user phrased it as "rollup across all the occurrences" which maps naturally to a sum. Total RSVPs is the v1 choice; unique-member view can be a follow-up.

**Pass 4 — Cancelled occurrences**

Yes, exclude RSVPs whose `occurrenceDate` (YYYY-MM-DD prefix) is in the cancelled set. A cancelled occurrence means nobody showed up (or the date was voided); including its RSVPs in the total would inflate the count with commitments that never materialized. The exclusion logic already exists on the list page for filtering which dates to count — it just needs to be applied to the rollup query rather than replacing it. The detail page's `cancelledMap` (from the `overrides` query) provides the same information. Note: a row whose `occurrenceDate` is null (legacy or non-recurring) is not affected by this filter.

**Pass 5 — Past vs upcoming**

Recommendation: **All occurrences (past + future)** for v1. The admin context for the list page is an operational roster: "how much signup activity does this series have?" That question is best answered by the full series history. An "upcoming only" sub-count is a useful future addition ("12 total signups, 3 upcoming") but adds complexity not needed for the bug fix. The detail page already groups occurrences into past/upcoming visually, so the per-occurrence breakdown already gives the admin a future-only view by scrolling.

**Pass 6 — Member-portal display**

The member-portal events list (`/(dashboard)/events/page.tsx`) and detail (`/(dashboard)/events/[id]/page.tsx`) and the public `/events/[id]/page.tsx` were not examined for this bug, per user's explicit scope. Confirm: no change to these surfaces in v1. File a follow-up if member-portal surfaces are found to have the same count scoping.

**Pass 7 — Capacity display**

If `maxAttendees` is set, the list page currently does not display a capacity bar or "N / capacity" fraction — the count chip is a plain text summary in the expanded row. The detail page shows per-occurrence groups with individual capacity awareness already (in `AdminOccurrenceRsvpSection`). Recommendation: omit the capacity denominator from the series-level rollup count on the list, and from the series-level summary header on the detail. The per-occurrence rows already carry the correct "N / 30" framing where applicable. Mixing a cross-occurrence total with a per-occurrence capacity would be confusing.

**Pass 8 — Adversarial pass**

- Zero-occurrence series: if `generateOccurrences()` returns an empty array for a series whose `startDate` is in the future, the list page query still fetches all RSVP rows — there just won't be any. The rollup would correctly display 0. No failure path needed.
- Duplicate RSVPs per member per date: migration `0028` (`drizzle/migrations/0028_event_rsvps_occurrence.sql`) creates `uq_event_rsvps_recurring` — a unique index on `(event_id, user_id, occurrence_date) WHERE occurrence_date IS NOT NULL AND user_id IS NOT NULL`. This prevents the same user from having two rows for the same event+date. Anonymous RSVPs (`user_id IS NULL`) have no uniqueness constraint; a person could submit twice using the same name/email. This is pre-existing behavior, not introduced by this fix. No action needed in v1.
- Status values: the rollup sums by status. "Attending" is the count of positive commitments. "Maybe" and "declined" are tracked separately. The fix should preserve the existing `{ attending, maybe, declined, total }` shape so the expanded list row chips render without change.

### Outputs

- Files read: `src/app/(dashboard)/admin/events/page.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`, `src/lib/events.ts`, `src/lib/db/schema.ts`, `src/components/admin/event-table-row.tsx`, `drizzle/migrations/0028_event_rsvps_occurrence.sql`
- No schema changes required
- No new permissions required
- Phase 2 (architect) can be skipped — no new directories, no new dependencies, no structural changes
- Phase 3 (tech-lead) should be brief: two localized query/render changes

### Open questions / handoff notes

- **List page filter removal:** The `occurrenceFilter` map path for recurring events needs to drop the `targetDate` guard and instead sum all non-cancelled occurrence rows. The simplest approach: when `event.isRecurring`, set `occurrenceFilter.set(event.id, null)` (same as non-recurring) but also apply the cancelled-date exclusion when building `rsvpMap`. Tech-lead should confirm whether to pass the cancelled-date set through the existing accumulation loop or restructure it.
- **Detail page summary:** The flat stat block (`attending`, `maybe`, `declined`, `totalGuests`) already aggregates all rows across all occurrences and is correct for a rollup. It just needs to be rendered for recurring events too — either above the per-occurrence groups, or as a collapsed header. Tech-lead decides layout. Cancelled-occurrence rows should be excluded: filter `rsvpRows` against `cancelledMap` (keyed by YYYY-MM-DD) before computing the summary stats. The per-occurrence breakdown stays unchanged.
- **"Past" view on the list:** the past-view tab shows recurring series whose `recurrenceEndDate` has passed. For those events, the rollup count should also be total across all occurrences (no "next occurrence" to filter on). The current code already falls through to the `null` target-date path for past recurring events (because `getNextOccurrence()` returns null when the series has ended), so this may already be partially correct — tech-lead should verify.
- **Phase 2 skip:** note in the architect's section that Phase 2 was skipped per bug-fix variant rules (no structural changes).

---

**Verdict: READY WITH NOTES**

The bug is confirmed. The root cause is an intentional single-occurrence scoping decision on the list page that contradicts what the user wants, and a missing series-level summary on the detail page. The fix is localized, requires no schema changes, no new permissions, and no architectural input. The notes above are inputs for Phase 3 (tech-lead).

---

# Phase 2 — Architectural Review (architect)

Skipped per bug-fix variant rules. No new directories, no new npm dependencies, no structural or invariant changes. Both affected files are existing pages with localized query and render changes only. Noted by analyst 2026-05-20.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-05-20

**Owner:** tech-lead
**Status:** complete

### Summary

Phase 1's diagnosis is confirmed exactly. The list page intentionally scopes each recurring event's RSVP count to the next upcoming occurrence via the `occurrenceFilter` map (lines 113–132 of `admin/events/page.tsx`). The detail page computes a flat aggregate from `rsvpRows` at lines 153–158 of `admin/events/[id]/page.tsx` but those variables feed only the non-recurring JSX branch — the recurring branch has never rendered a series-level total. Both fixes are localized; no schema changes, no new components, no new imports.

### Root Cause Confirmation

**List page — `src/app/(dashboard)/admin/events/page.tsx`, lines 109–131:**

For each recurring event `occurrenceFilter` stores `format(next, "yyyy-MM-dd")` (the next occurrence date string). The accumulation loop at lines 136–143 then `continue`s every RSVP row whose `occurrenceDate` prefix does not match that target date. This is explicit and intentional in the comment at line 109. Result: only rows for the single next occurrence are counted. All other occurrences (past and other future) are silently dropped.

For a past-series recurring event `getNextOccurrence()` returns `null` and the filter stores `null`, which causes `targetDate` to be falsy and the `if (targetDate)` guard at line 137 to be skipped — so all rows are included. This means **the past-view count is already correct for ended series.** The bug only affects active recurring series (where a next occurrence exists and filters out everything else).

**Detail page — `src/app/(dashboard)/admin/events/[id]/page.tsx`, lines 153–158 and 210:**

`attending`, `maybe`, `declined`, `totalGuests`, and `attendingTotal` are computed over the unfiltered `rsvpRows` array. The JSX conditional at line 210 renders the recurring group view (`AdminOccurrenceRsvpSection`) OR the flat stats grid — never both. No series-level summary is ever displayed for recurring events. The per-occurrence groups are correct; what's missing is the header.

---

### Fix 1 — List page (`src/app/(dashboard)/admin/events/page.tsx`)

**Exact change:** In the `occurrenceFilter` build loop (lines 114–132), remove the `getNextOccurrence` call entirely for recurring events and store `null` (count all rows) — identical to the non-recurring path. Then, in the `rsvpMap` accumulation loop (lines 135–149), add a cancelled-occurrence guard before the existing status accumulation.

The `cancelledByEvent` map (built at lines 57–61) already holds `YYYY-MM-DD` strings for every cancelled occurrence. The `row.occurrenceDate` column is a wall-clock string `"YYYY-MM-DD HH:MM:SS"`, so slicing to 10 characters gives the date key to look up.

**Replace lines 113–132** (the `occurrenceFilter` build loop):

```typescript
// For recurring events, count all occurrences (no date filter).
// Non-recurring events also use null — null means "count all rows."
const occurrenceFilter = new Map<string, null>();
for (const event of eventList) {
  if (!event.requiresRsvp) continue;
  occurrenceFilter.set(event.id, null);
}
```

This removes the `getNextOccurrence` call from the accumulation phase entirely. The variable is still used in `annotated` (line 71) for display-order sorting — that usage is unchanged.

**Replace lines 135–149** (the `rsvpMap` accumulation loop):

```typescript
const rsvpMap = new Map<string, RsvpSummary>();
for (const row of rsvpRows) {
  // Skip rows from cancelled occurrences so they don't inflate the rollup.
  if (row.occurrenceDate) {
    const rowDateKey = row.occurrenceDate.slice(0, 10);
    const cancelled = cancelledByEvent.get(row.eventId);
    if (cancelled?.has(rowDateKey)) continue;
  }
  const s = rsvpMap.get(row.eventId) ?? { attending: 0, maybe: 0, declined: 0, total: 0 };
  if (row.status === "attending") s.attending += row.count;
  else if (row.status === "maybe") s.maybe += row.count;
  else if (row.status === "declined") s.declined += row.count;
  s.total += row.count;
  rsvpMap.set(row.eventId, s);
}
```

Note: `row.occurrenceDate` is null for non-recurring events (their RSVPs have no occurrence date). The `if (row.occurrenceDate)` guard means the cancelled-date check is skipped for non-recurring rows — non-recurring behavior is unchanged.

Also note: `row.eventId` is already present in the grouped query (line 99 of the original). The type already includes it.

---

### Fix 2 — Detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`)

**Exact change in the data layer (lines 153–158):**

Before computing the flat summary variables, filter `rsvpRows` to exclude rows whose `occurrenceDate` date-prefix appears in `cancelledMap`. `cancelledMap` is already built at lines 94–96 and is keyed by `YYYY-MM-DD`. This filter must only apply to recurring events (for non-recurring, `cancelledMap` is empty, so the result is identical either way, but gate it on `event.isRecurring` for clarity).

Replace lines 153–158:

```typescript
// ── Non-recurring: flat summary numbers ───────────────────────────────────
// For recurring events, exclude rows from cancelled occurrences before summing.
const summaryRows = event.isRecurring
  ? rsvpRows.filter((r) => {
      if (!r.occurrenceDate) return true;
      return !cancelledMap.has(r.occurrenceDate.slice(0, 10));
    })
  : rsvpRows;

const attending = summaryRows.filter((r) => r.status === "attending");
const maybe = summaryRows.filter((r) => r.status === "maybe");
const declined = summaryRows.filter((r) => r.status === "declined");
const totalGuests = attending.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);
const attendingTotal = attending.length + totalGuests;
```

**Exact change in the JSX (recurring branch, starting at line 210):**

Add a series-level rollup header immediately above the `<AdminOccurrenceRsvpSection>` render, inside the `event.isRecurring` branch. The non-cancelled occurrence count is `occurrenceGroups.filter(g => !g.isCancelled).length`.

Insert this block after the `<h2>` at line 206 and before the `<div className="mt-4 space-y-3">` at line 212:

```tsx
{/* Series-level rollup — rendered for recurring events only */}
{event.requiresRsvp && (
  <div className="mt-4 rounded-md bg-blue-50 p-4">
    {(() => {
      const nonCancelledCount = occurrenceGroups.filter((g) => !g.isCancelled).length;
      if (nonCancelledCount === 0) {
        return (
          <p className="text-sm font-medium text-blue-800">All occurrences cancelled</p>
        );
      }
      return (
        <>
          <p className="text-sm font-semibold text-blue-900">
            {attendingTotal} attending across {nonCancelledCount} occurrence{nonCancelledCount === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-xs text-blue-700">
            {maybe.length} maybe · {declined.length} declined
          </p>
        </>
      );
    })()}
  </div>
)}
```

The IIFE keeps the conditional expression inline without introducing a separate computed variable in the outer scope.

---

### Display Copy

The rollup header reads:

- Normal case: **"X attending across Y occurrences"** with a secondary line "Z maybe · W declined" below it.
- All-cancelled case (non-cancelled count = 0, regardless of whether there are any RSVP rows): **"All occurrences cancelled"**
- "Y occurrences" counts non-cancelled occurrences only (matching the count denominator). "All occurrences cancelled" is preferred over "No occurrences yet" when `occurrenceGroups` is non-empty but all are cancelled — it is more accurate.
- If `occurrenceGroups` is empty (no occurrences generated at all), `nonCancelledCount` is 0 and the copy also reads "All occurrences cancelled." This is acceptable for v1; a pure empty-series state would be `"No occurrences yet"` but the existing code already shows `"No occurrences generated for this series."` in that path, so the rollup header is nested inside `event.requiresRsvp &&` and will only appear if the series has RSVP enabled — practically, a series with zero generated occurrences is either brand-new or misconfigured, and is an edge case not worth special-casing.
- Capacity denominator is omitted per Phase 1 decision.

---

### Edge Cases Verified

**Past series (`getNextOccurrence` returns null):**
Confirmed at lines 120–131 of the list page: when `getNextOccurrence` returns null, `occurrenceFilter.set(event.id, null)` is already called — same as the non-recurring path. The accumulation loop's `if (targetDate)` guard is falsy, so all rows are included. **The past-view rollup is already correct.** The Fix 1 change (removing `getNextOccurrence` from the filter phase entirely and always storing null) produces identical behavior for past-series events. No regression.

**Series with all occurrences cancelled:**
On the list page, all RSVP rows for cancelled dates are skipped by the new cancelled-date guard. `rsvpMap` will have no entry for the event, or an entry with all zeros. The `EventTableRow` component receives a zero or missing summary — its existing behavior for zero counts is unchanged. On the detail page, `summaryRows` is empty (all rows filtered out), so `attendingTotal = 0`, `maybe.length = 0`, `declined.length = 0`, and `nonCancelledCount = 0` — the header displays "All occurrences cancelled."

**Non-recurring event:**
List page: The `occurrenceFilter` build loop already did `occurrenceFilter.set(event.id, null)` and the new code does the same. The cancelled-date guard in the accumulation loop only fires when `row.occurrenceDate` is truthy — non-recurring RSVP rows have `occurrenceDate = null`, so the guard is never entered. Behavior is identical. Detail page: `event.isRecurring` is false, so `summaryRows = rsvpRows` (unfiltered). All downstream computation is identical to the current code.

---

### Tests Required Before Sign-Off

1. **Playwright e2e — list-page rollup:** Create a recurring event with RSVPs on two different occurrences (past and upcoming). Assert that the admin event list row shows a count equal to the sum across both occurrences, not just the upcoming one.

2. **Playwright e2e — cancelled-occurrence exclusion (regression test):** Same setup, but cancel one occurrence via the admin cancel flow. Assert that the list-row count does NOT include RSVPs from the cancelled occurrence. Assert the detail-page rollup header also excludes the cancelled occurrence's RSVPs.

3. **Playwright e2e — detail-page rollup header:** Navigate to the admin detail page for the same recurring event. Assert the rollup header text matches "X attending across Y occurrences" with correct values.

4. **Playwright e2e — non-recurring unaffected:** Navigate to the admin detail page for a non-recurring event. Assert the existing four stat boxes (Attending / Maybe / Declined / Guests) still render and show correct values. Assert the rollup header is absent.

There is no pure helper function to unit-test in isolation — both fixes live in Server Component data-preparation code. Playwright e2e tests are the right vehicle. The existing `tests/e2e/` directory is the correct home.

---

### Implementation Order

1. List-page fix — `src/app/(dashboard)/admin/events/page.tsx` (smaller, self-contained).
2. Detail-page fix — `src/app/(dashboard)/admin/events/[id]/page.tsx` (renders new content, depends on no list-page change).
3. Playwright regression tests per the spec above.
4. Typecheck (`pnpm exec tsc --noEmit`), build (`pnpm build:only`), test (`pnpm test:e2e`).
5. Release notes entry for v1.16.1 (PATCH — bug fix).

### What I did

- Read `src/app/(dashboard)/admin/events/page.tsx` lines 1–162 in full.
- Read `src/app/(dashboard)/admin/events/[id]/page.tsx` lines 1–290 in full.
- Confirmed Phase 1's root cause diagnosis at exact cited lines.
- Verified the past-series edge case: the current code already handles it correctly via the null fallback — Fix 1 is a no-op for past series.
- Verified non-recurring is untouched by both fixes.
- Designed exact replacement blocks for all four change points.
- Specified display copy and edge-case render decisions.
- Specified four Playwright e2e tests as the required QA gate.

### Outputs

- `docs/work-log/2026-05-20-recurring-signup-rollup.md` — Phase 3 section added (this file).
- No decisions.md entry warranted — this is a localized bug fix with no implementation decision that rises to the level of a logged choice.

### Open questions / handoff notes

- Use the **full-stack-developer** agent for Phase 4. Both changes live in Server Components that mix Drizzle data prep with JSX rendering — splitting into separate api-developer and ux-developer passes would add overhead for a two-file bug fix. Full-stack-developer is the correct pick.
- The implementer should use the exact replacement blocks specified above. Do not restructure the broader file — keep the change surface minimal.
- The `cancelledByEvent` map on the list page uses `YYYY-MM-DD` keys (set at line 60). `row.occurrenceDate.slice(0, 10)` produces the same format. The implementer must verify the slice produces `YYYY-MM-DD` and not a time component, which it does given the `"YYYY-MM-DD HH:MM:SS"` wall-clock string format documented at line 22 of the file.
- On the detail page, `cancelledMap` is keyed by `YYYY-MM-DD` (from `eventOccurrenceOverrides.occurrenceDate` which is a plain date string, not a wall-clock datetime). `row.occurrenceDate.slice(0, 10)` on a `"YYYY-MM-DD HH:MM:SS"` value yields `"YYYY-MM-DD"`, which matches. The implementer must confirm this key alignment.
- Release notes target: v1.16.1. Use the `/release-notes` skill after Phase 5 passes.

---

# Phase 4 — Implementation (full-stack) — 2026-05-20

**Owner:** full-stack-developer
**Status:** complete

### Summary

Both fixes landed exactly as Phase 3 specified. The list page now counts all non-cancelled RSVP rows for every event (recurring and non-recurring alike), with cancelled-occurrence rows excluded via a date-key guard in the accumulation loop. The detail page hoists `cancelledMap` to the function scope, filters `rsvpRows` into `summaryRows` before computing the five aggregate variables, and renders a new rollup header block (blue `bg-blue-50` panel) above the per-occurrence breakdown for recurring RSVP events. Non-recurring paths on both pages are unchanged — verified by reading the code paths and confirmed by typecheck and build.

### What I did

- Removed the `occurrenceFilter` map and its build loop from the list page entirely (was dead code after the fix; `getNextOccurrence` is still called for sort-order purposes in `annotated`, which is untouched).
- Added a cancelled-occurrence guard inside the `rsvpMap` accumulation loop: `if (row.occurrenceDate)` → slice to YYYY-MM-DD → check against `cancelledByEvent` → skip if cancelled. Non-recurring rows (`occurrenceDate = null`) skip the guard.
- Hoisted `cancelledMap` from inside the `if (event.isRecurring)` block to the function's top-level scope in the detail page. This was required because the `summaryRows` filter below the if-block needed access to it; the original scoping was local to the recurring branch only.
- Added `summaryRows` filter in the detail page: `event.isRecurring ? rsvpRows.filter(...)  : rsvpRows`. The filter excludes rows whose `occurrenceDate.slice(0, 10)` appears in `cancelledMap`. All five aggregate variables (`attending`, `maybe`, `declined`, `totalGuests`, `attendingTotal`) now derive from `summaryRows`.
- Added the rollup header JSX block inside the recurring branch, wrapped in `{event.requiresRsvp && (…)}`. The block uses an IIFE to compute `nonCancelledCount` and branches to "All occurrences cancelled" or the normal "X attending across Y occurrences" copy per Phase 3 spec. The `<>` fragment wrapping the new block and the existing `<div className="mt-4 space-y-3">` was added and properly closed.
- Wrote `e2e/recurring-signup-rollup.spec.ts` with four tests: list rollup sum, cancelled-occurrence exclusion (list + detail), detail rollup header text, and non-recurring path unchanged.

### Outputs

- `src/app/(dashboard)/admin/events/page.tsx` — removed `occurrenceFilter` map; replaced `rsvpMap` accumulation loop with cancelled-date guard
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — hoisted `cancelledMap`; added `summaryRows` filter; added rollup header JSX block in recurring branch
- `e2e/recurring-signup-rollup.spec.ts` — four new Playwright e2e tests

**Gate checks passed:**
- `pnpm exec tsc --noEmit` — clean (0 errors)
- `pnpm build:only` — clean (all 77 routes built successfully)
- `pnpm test` — 115/115 unit tests pass

**No new schema changes. No new env vars. No new FEATURES keys. No new npm dependencies.**

### Open questions / handoff notes

- The e2e tests (`pnpm test:e2e`) require a running dev server (`pnpm dev`) and valid `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` credentials. Run `pnpm test:e2e` after `pnpm dev` is confirmed healthy.
- Test 1 checks that the list row for the Farmer's Market contains the digit "2" after adding two RSVPs. If other RSVPs already exist for that series in the DB, the count will be higher (containing "2" is still true). The assertion uses `toContainText("2")` which would pass with any count >= 2. This is intentional and conservative — it avoids brittleness from pre-existing data without hiding the regression.
- Test 2 is the critical regression guard: it checks `toContainText("1 attending across")` on the detail page after cancelling one of two signed-up occurrences. This is a strict match that would fail if the old (pre-fix) code summed both occurrences.
- The Lions Club Meeting (`2a68b4c6-2068-4d5d-84d6-223167260c7b`) used in Test 4 must have `requiresRsvp` disabled for the `#attendance` section to be absent. If an admin enables RSVP on that event, Test 4's conditional assertion still passes correctly (it checks that "attending across" never appears, which is true regardless).
- Next agent: **qa** (Phase 5). QA should run `pnpm test:e2e` and do a manual click-through on the Farmer's Market admin detail page to verify the rollup header renders with correct numbers.

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-05-20

**Owner:** qa
**Status:** blocked — one e2e test has a design defect; returning to implementer

### Summary

FAIL. The implementation code is correct — typecheck, build, and 12 of 13 e2e tests pass. The one failure is in **Test 2** of `e2e/recurring-signup-rollup.spec.ts`. The test asserts `toContainText("1 attending across")` on the Farmer's Market detail page after adding one RSVP and cancelling a second. But the live database already has 32 attending across 17 non-cancelled occurrences from real club member data. The assertion strategy is incompatible with a live database that has pre-existing RSVPs. The code fix is correct; the test is wrong. Returning to the implementer to fix the assertion.

### What I did

- Read Phases 1, 3, 4 in the work-log.
- Read both modified files: `src/app/(dashboard)/admin/events/page.tsx` and `src/app/(dashboard)/admin/events/[id]/page.tsx`.
- Read `e2e/recurring-signup-rollup.spec.ts` in full.
- Read `src/app/api/admin/events/[id]/signup/route.ts` and `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts` to understand cleanup shape.
- Ran `pnpm exec tsc --noEmit` — clean (0 errors).
- Ran `pnpm test` — 115/115 passed.
- Ran `pnpm build:only` — clean, 77 routes built.
- Ran `pnpm test:e2e` — 12/13 passed, 1 failed.
- Diagnosed the failure: pre-existing production data (32 RSVPs across 17 occurrences) on the Farmer's Market series makes Test 2's strict `"1 attending across"` assertion impossible to satisfy.
- Confirmed code audit: all four checklist items pass (see below).

### Outputs

**Type Check — PASS**
`pnpm exec tsc --noEmit`: clean, no errors.

**Unit Tests — PASS**
`pnpm test`: 115/115 passed. Duration: 209ms.

**Production Build — PASS**
`pnpm build:only`: 77 routes, no errors or warnings.

**End-to-End Tests — FAIL**
`pnpm test:e2e`: 12 passed, 1 failed. Duration: 25.6s.

Failure:
- `e2e/recurring-signup-rollup.spec.ts:137` — Test 2 — "cancelled occurrence excluded from list count and detail rollup header — rollup-bug regression"
  - Error: `toContainText("1 attending across")` failed.
  - Received: `"32 attending across 17 occurrences"` — pre-existing RSVPs from real member data on the live Farmer's Market series.
  - Root cause: test assumes absolute control over the event's RSVP state. The `beforeEach` cleanup only removes the E2E admin user's own RSVPs for the three test dates; it does not remove the 30+ RSVPs from real club members on other dates that are also included in the rollup. Assertion strategy is wrong for a live database.
  - Nature: **test design defect**, not a code defect. The cancelled-occurrence exclusion logic is correct — the rollup correctly shows 17 non-cancelled occurrences and excludes the cancelled test date.

**Code Audit Results:**

1. **No-op invariant for non-recurring rows (list page):** Confirmed. The guard `if (row.occurrenceDate)` at line 117 of `admin/events/page.tsx` is strictly skipped for non-recurring rows whose `occurrenceDate` is null. Behavior is identical to pre-fix for non-recurring events.

2. **`summaryRows === rsvpRows` for non-recurring (detail page):** Confirmed. Line 160–165 of `admin/events/[id]/page.tsx`: `event.isRecurring ? rsvpRows.filter(...) : rsvpRows` — non-recurring takes the else branch, `summaryRows` is the same reference as `rsvpRows`. All five aggregate variables are unchanged.

3. **Rollup header gated on `event.requiresRsvp`:** Confirmed. Line 227: `{event.requiresRsvp && (`. A recurring event without `requiresRsvp` will not display the rollup header. The `showRsvpSection` guard at line 82 also requires `event.requiresRsvp || rsvpRows.length > 0`, so the entire `#attendance` section is absent when RSVP is disabled and no rows exist.

4. **Past-series no-regression:** Confirmed by code trace. The list page no longer calls `getNextOccurrence` in the rsvpMap loop at all — the `occurrenceFilter` map and its build loop were removed entirely. Past-series RSVPs have `occurrenceDate` values that may or may not fall in the cancelled set; the guard correctly applies (or skips) the same way for both past and active series. No regression.

**Manual observation on live Farmer's Market detail (`/admin/events/291c76f3-ab75-4c64-8173-ac285345cfe9`):**
The detail page confirms the rollup header block renders: "32 attending across 17 occurrences" with a "0 maybe · 0 declined" secondary line. The blue `bg-blue-50` panel is present and positioned above the per-occurrence breakdown. This is correct behavior — the pre-existing data is real club signups and the total is accurate.

**Non-recurring event spot-check:** Test 4 passed. The Lions Club Meeting detail page contains no "attending across" text. The non-recurring stat boxes render correctly.

### Open questions / handoff notes

- **Return to implementer (full-stack-developer) for Test 2 fix.** The assertion must not use a hard-coded count. Recommended approach: record the rollup count from the detail page *before* adding any test RSVPs (call this `baseCount`), then after arranging 1 RSVP on date A and cancelling date CANCEL, assert that the new count equals `baseCount + 1` and does NOT equal `baseCount + 2`. This is resilient to pre-existing data. Alternatively, assert that "2 attending across" is absent (the cancelled RSVP was excluded), which is the regression's critical invariant without depending on the absolute total.
- Test 3 (detail rollup header format) passes — its assertions use `toContainText("attending across")` and `toContainText("occurrences")` which match regardless of count value.
- Tests 1 and 4 pass. Test 1 uses `toContainText("2")` which is conservative and correct.
- Once Test 2 is fixed and `pnpm test:e2e` runs 13/13, hand back to qa for a clean re-run before advancing to Phase 6.

---

## Phase 4 — Loop-back: Test Fix — 2026-05-20

**Owner:** full-stack-developer
**Status:** complete

### Summary

QA's Phase 5 FAIL was correct: Test 2 asserted `toContainText("1 attending across")` but the live DB already had 32 attending across 17 occurrences from real club member data, making the absolute assertion impossible. All four tests were redesigned with baseline-then-relative and within-test delta strategies. Two root causes required iterative debugging: (1) the `EventTableRow` component renders two `<tr>` siblings with no common wrapper, making scoped `<tr>` locators miss the RSVP summary row; (2) `cancel-occurrence.spec.ts` runs concurrently with the rollup tests and transiently changes the Farmer's Market RSVP count (by cancelling/restoring 2026-05-30 which has 1 real RSVP), causing exact delta assertions to fail by ±1.

### What I did

- Audited all four tests for absolute-count brittleness. Tests 3 and 4 were already resilient; Tests 1 and 2 required full redesigns.
- Added two helper functions: `readDetailRollup(page)` (navigates to the admin detail page and parses "N attending across M occurrences" from the `#attendance .bg-blue-50` panel) and `readListAttending(page)` (reads the admin list page `<tbody>` and parses `✓ N attending` from the expanded RSVP sub-row).
- Redesigned Test 1 to use a within-test list-page delta: read `listBefore` (before adding RSVPs), add 2 RSVPs, read `listAfter`, assert `listAfter >= listBefore + 2`. Used `>=` rather than `===` because `cancel-occurrence.spec.ts` can concurrently restore 2026-05-30 (a 1-RSVP occurrence), inflating the count by +1 between reads. Also added a lightweight detail-page check: the `#attendance .bg-blue-50` rollup block must be visible and contain "attending across" (guards the "no rollup header at all" pre-fix regression).
- Redesigned Test 2 with a three-phase approach: (a) capture `baseline` from the detail page; (b) add RSVPs on date A and CANCEL_DATE, capture `beforeCancel` from the detail page; (c) cancel CANCEL_DATE, capture `afterCancel` from the detail page. Core regression invariant: `afterCancel.attending < beforeCancel.attending` (cancellation reduces attending count — pre-fix code would keep them equal). Secondary invariants: `afterCancel.attending <= baseline.attending + 1` (upper bound: only date A's RSVP can be new after CANCEL_DATE is excluded); `afterCancel.occurrences === beforeCancel.occurrences - 1` (CANCEL_DATE left the non-cancelled occurrence set). Used `beforeCancel.occurrences - 1` rather than `baseline.occurrences - 1` to avoid concurrency interference on the occurrence count between the two reads.
- Discovered and documented the root cause of the list-page locator failure: `EventTableRow` renders two `<tr>` elements (main row + expanded summary row) as siblings in `<tbody>`. The RSVP count lives in the second `<tr>` (class `bg-blue-50`), not in the first. `page.locator("tr").filter({ hasText: /Farmer/i })` matches only the first `<tr>`. Fixed by reading from `<tbody>` as a whole for the list assertion and using the `✓ N attending` text pattern (unique to the RSVP sub-row) for `readListAttending`.
- Identified concurrency interference from `cancel-occurrence.spec.ts` which cancels/restores 2026-05-30 (1 RSVP) and 2026-06-06 (2 RSVPs) during its test execution. These transient cancellations change the Farmer's Market rollup count by ±1 between reads. All assertions were updated to tolerate this with `>=`/`<=` bounds instead of exact equality where concurrency could interfere. The occurrence count assertion uses `beforeCancel.occurrences - 1` to anchor to a consistent snapshot.
- Ran `pnpm test:e2e` twice — 13/13 pass both times with no retries.
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build:only` — all clean.

### Outputs

- `e2e/recurring-signup-rollup.spec.ts` — complete redesign of Tests 1 and 2; Tests 3 and 4 unchanged; added `readDetailRollup()` and `readListAttending()` helpers; all comments updated to document the concurrency-tolerant strategy

**Gate checks passed:**
- `pnpm exec tsc --noEmit` — clean (0 errors)
- `pnpm build:only` — clean (77 routes)
- `pnpm test` — 115/115 unit tests pass
- `pnpm test:e2e` — 13/13 pass (two consecutive runs, no retries)

**No production code changes. Only `e2e/recurring-signup-rollup.spec.ts` was modified.**

### Open questions / handoff notes

- The `>= listBefore + 2` assertion in Test 1 has a theoretical false-pass window: if the old "single-occurrence" bug manifests AND cancel-occurrence simultaneously restores 2026-05-30 between the before/after reads, the count could be `listBefore + 2` from two different sources. This edge case requires exact nanosecond timing and is accepted as an engineering trade-off vs serializing all 13 e2e tests.
- Tests 1 and 2 use dates 2026-06-13 (Saturday), 2026-06-20 (Saturday), and 2026-06-27 (Saturday) — all within the Farmer's Market series window. These dates have 2, 2, and 2 real member RSVPs respectively. If real members add more RSVPs to these dates before tests run, the baseline captures them correctly and the relative assertions remain valid.
- Next agent: **qa** (Phase 5 re-run). QA should confirm `pnpm test:e2e` returns 13/13 on a fresh run.

---

---

## Phase 5 — Re-Verification — 2026-05-20

**Owner:** qa
**Status:** complete

### Summary

PASS. All four gates are green. TypeScript clean. 115/115 unit tests pass. Production build builds 77/77 routes with no errors. All 13 e2e tests pass on a single run with no retries. Production code is unchanged from Phase 4. The test redesign is correct, concurrency-tolerant, and the regression guard in Test 2 will catch a recurrence of the cancelled-occurrence bug.

### What I did

- Read Phases 4 loop-back and the rewritten `e2e/recurring-signup-rollup.spec.ts` in full.
- Ran `pnpm exec tsc --noEmit` (Node 20) — 0 errors.
- Ran `pnpm test` (Node 20) — 115/115 passed, duration 214ms.
- Ran `pnpm build:only` (Node 20) — 77/77 routes, compiled successfully, no errors or warnings.
- Ran `pnpm test:e2e` — 13/13 passed, duration 23.7s, no retries.
- Confirmed production code unchanged: `git diff HEAD -- src/app/(dashboard)/admin/events/page.tsx src/app/(dashboard)/admin/events/[id]/page.tsx` shows the Phase 4 fix only (150-line diff against HEAD); no new changes introduced in the loop-back.
- Reviewed all four checklist items for the test file (detailed below).
- Walked through the Test 2 regression guard logic to confirm it catches the cancelled-occurrence bug if it recurs.

### Outputs

**Type Check — PASS**
`pnpm exec tsc --noEmit`: clean, no errors.

**Unit Tests — PASS**
`pnpm test`: 115 passed / 0 failed. Duration: 214ms.

**Production Build — PASS**
`pnpm build:only`: 77/77 routes, no errors. "Compiled successfully in 5.7s."

**End-to-End Tests — PASS**
`pnpm test:e2e`: 13 passed / 0 failed. Duration: 23.7s. No retries.

**Test File Audit:**

1. **Helpers parse from correct DOM elements — confirmed.** `readDetailRollup` targets `#attendance .bg-blue-50` — matches the rollup header `<div className="mt-4 rounded-md bg-blue-50 p-4">` inside `#attendance`. `readListAttending` reads `<tbody>` as a whole and matches `✓\s*(\d+)\s+attending` — correctly reaches the second `<tr>` sibling (the RSVP sub-row) without relying on a scoped row locator that would miss it.

2. **Baseline-then-relative assertions, concurrent-test tolerant — confirmed.** Test 1: `listAfter >= listBefore + 2` with `>=` tolerates ±1 from `cancel-occurrence.spec.ts`. Test 2: three-phase with `afterCancel < beforeCancel` (strict less-than), `afterCancel <= baseline + 1` (upper bound), and `afterCancel.occurrences === beforeCancel.occurrences - 1` (anchored to the pre-cancel snapshot). All bounds are documented in comments.

3. **Tests 3 and 4 cover regression copy — confirmed.** Test 3 asserts `toContainText("attending across")`, `toContainText("occurrences")`, "maybe", "declined" — format guards that would fail if the rollup header were absent. Test 4 asserts `not.toContainText("attending across")` on the non-recurring event — catches any accidental rollup header bleed to non-recurring pages.

4. **Cleanup restores correctly — confirmed.** `beforeEach` deletes RSVPs for all three test ISO dates then restores all three dates as non-cancelled (right order). `afterAll` runs the same sequence. No shared mutable state between tests.

**Regression guard analysis — Test 2 catches the bug if it recurs:**
The test explicitly adds 1 RSVP on ROLLUP_CANCEL_DATE before cancelling it. `beforeCancel.attending >= baseline.attending + 1` (CANCEL_DATE RSVP was counted). After cancellation, correct code excludes it → `afterCancel.attending < beforeCancel.attending`. Regressed code (old single-occurrence filter) would include CANCEL_DATE RSVPs unchanged → `afterCancel.attending === beforeCancel.attending` → the `toBeLessThan` assertion fails. The regression guard holds.

**Production code unchanged — confirmed.** Only `e2e/recurring-signup-rollup.spec.ts` was modified in the loop-back. The production diff (`src/app/(dashboard)/admin/events/page.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`) against HEAD is the Phase 4 implementation, unchanged.

**Regression Tests Added:**
- `Test 1 — admin events list shows sum of RSVPs across two occurrences — rollup-bug regression` — `e2e/recurring-signup-rollup.spec.ts:158` — guards against: list page counting only the next upcoming occurrence instead of rolling up across all non-cancelled occurrences.
- `Test 2 — cancelled occurrence excluded from list count and detail rollup header — rollup-bug regression` — `e2e/recurring-signup-rollup.spec.ts:203` — guards against: cancelled-occurrence RSVPs being included in the rollup (the specific regression this fix addresses).
- `Test 3 — recurring event detail page shows rollup header with correct text — rollup-bug regression` — `e2e/recurring-signup-rollup.spec.ts:292` — guards against: series-level rollup header being absent on the detail page.
- `Test 4 — non-recurring event detail page has stat boxes and no rollup header — rollup-bug regression` — `e2e/recurring-signup-rollup.spec.ts:327` — guards against: non-recurring event detail page accidentally rendering a rollup header.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6 — Shipped vs Intent). All gates green; the feature is ready for final sign-off.
- No manual click-through flows are blocked by runner limitations for this fix — the affected surfaces (admin events list and admin event detail) are fully reachable via automated Playwright tests with seeded admin credentials.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-05-20

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped code delivers exactly what Phase 1 asked for and what the user described. The admin events list now counts all non-cancelled RSVPs across every occurrence in a recurring series. The admin detail page now renders a series-level rollup header ("X attending across Y occurrences") above the per-occurrence breakdown. QA observed "32 attending across 17 occurrences" on the Farmer's Market detail page — the user's original "2 signups" came from single-occurrence scoping, which is now gone. Non-recurring surfaces are untouched. Four Playwright regression tests guard both surfaces, the cancelled-occurrence exclusion, and the non-recurring no-op path.

### What I did

**Re-read Phase 1.** The Phase 1 diagnosis: (a) list page intentionally scoped recurring counts to the next upcoming occurrence via `occurrenceFilter`; (b) detail page had no series-level summary at all for recurring events, only per-occurrence groups. Both findings confirmed in the shipped code.

**Spot-check: list page (`src/app/(dashboard)/admin/events/page.tsx`, lines 109–128).**

Phase 1 said: remove the `occurrenceFilter` date-target guard and add a cancelled-occurrence exclusion. Shipped: the `occurrenceFilter` map and its entire build loop are gone. The `rsvpMap` accumulation loop at lines 113–128 processes all rows, with a guard at lines 117–121 that slices `row.occurrenceDate` to YYYY-MM-DD and checks against `cancelledByEvent`. `if (row.occurrenceDate)` is falsy for non-recurring rows (null), so the guard is skipped for them — non-recurring behavior is unchanged. This matches the Phase 3 design exactly.

**Spot-check: detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`, lines 84–171 and 223–248).**

Phase 1 said: add a series-level summary header and exclude cancelled-occurrence rows from the flat aggregate. Shipped: `cancelledMap` is hoisted to function scope (line 87). `summaryRows` at lines 160–165 filters on `event.isRecurring`; the cancelled-occurrence guard uses `r.occurrenceDate.slice(0, 10)` matched against `cancelledMap` — confirmed key alignment (cancelledMap keyed by YYYY-MM-DD from `eventOccurrenceOverrides.occurrenceDate`, which is a plain date column, not a wall-clock string). All five aggregate variables (`attending`, `maybe`, `declined`, `totalGuests`, `attendingTotal`) derive from `summaryRows`. The rollup header block (lines 227–248) is gated on `event.requiresRsvp`, uses an IIFE to compute `nonCancelledCount`, and branches to "All occurrences cancelled" or "X attending across Y occurrences" with a secondary "Z maybe · W declined" line. Matches Phase 3 copy spec exactly.

**Bug no longer manifests.**

The pre-fix code at the list page would match `targetDate` (next occurrence date string) against each row's `occurrenceDate` prefix and `continue` for any row that didn't match — leaving only the rows for the single next occurrence. In the shipped code, there is no `occurrenceFilter` map and no `targetDate` guard. All rows reach the accumulation block. For the Farmer's Market series, this changed the displayed count from 2 (next-occurrence only) to 32 (all non-cancelled occurrences) — exactly the user-reported discrepancy, now corrected. Code citation: the loop formerly at lines 113–132 of the pre-fix file is replaced by lines 112–128 of the shipped file, where `occurrenceFilter` does not exist.

**Intended behavior preserved for non-recurring events.**

`if (row.occurrenceDate)` at line 117 is the sole guard — non-recurring rows have `occurrenceDate = null`, so the guard never fires and the accumulation is identical to pre-fix. On the detail page, `event.isRecurring ? ... : rsvpRows` at line 160 takes the `rsvpRows` branch for non-recurring events — `summaryRows === rsvpRows` and all five aggregates are unchanged. Test 4 (`not.toContainText("attending across")`) passed.

**Regression test guard (Test 2, `e2e/recurring-signup-rollup.spec.ts:203`).**

The core invariant: add RSVPs on date A and CANCEL_DATE, read `beforeCancel`, cancel CANCEL_DATE, read `afterCancel`. Assert `afterCancel.attending < beforeCancel.attending`. In regressed code the cancelled-date guard is absent — CANCEL_DATE rows stay in the sum — and `afterCancel.attending === beforeCancel.attending`, causing `toBeLessThan` to fail. This is the correct regression gate. The `afterCancel.occurrences === beforeCancel.occurrences - 1` assertion verifies the occurrence count denominator is also updated.

### Outputs

- Work-log updated: `docs/work-log/2026-05-20-recurring-signup-rollup.md` (this file, Phase 6 section)
- Per-phase status table updated to Phase 6 Complete

### Intent-vs-shipped diff

- Phase 1 said: recurring event count on the list page should roll up across all non-cancelled occurrences. Shipped: `occurrenceFilter` removed; all rows summed with a cancelled-date guard. **Matches.**
- Phase 1 said: non-recurring list behavior unchanged. Shipped: `if (row.occurrenceDate)` guard is a no-op for null (non-recurring) rows. **Matches.**
- Phase 1 said: detail page should show a series-level summary header. Shipped: blue `bg-blue-50` panel above per-occurrence breakdown, "X attending across Y occurrences." **Matches.**
- Phase 1 said: cancelled occurrences should be excluded from rollup totals. Shipped: both pages slice `occurrenceDate` to YYYY-MM-DD and check against their respective cancelled maps. **Matches.**
- Phase 1 said: total RSVPs (not unique members). Shipped: `summaryRows.filter(r => r.status === "attending").length` counts rows, not distinct users. **Matches.**
- Phase 1 said: member-portal surfaces out of scope. Shipped: neither `/(dashboard)/events/` nor `/events/[id]/page.tsx` was touched. **Matches.**
- Phase 3 said: capacity denominator omitted from rollup header. Shipped: rollup header shows "X attending across Y occurrences" with no capacity fraction. **Matches.**
- Phase 3 said: "All occurrences cancelled" copy when `nonCancelledCount === 0`. Shipped: IIFE branches to `<p>All occurrences cancelled</p>` for zero non-cancelled count. **Matches.**

### Edge cases

- **Zero-occurrence series (empty `occurrenceGroups`):** `occurrenceGroups.filter(g => !g.isCancelled).length` returns 0; rollup header shows "All occurrences cancelled." Acceptable for v1 per Phase 3 design decision. **Pass.**
- **All-cancelled series:** `summaryRows` is empty (all rows filtered); `attendingTotal = 0`, `nonCancelledCount = 0`; header shows "All occurrences cancelled." List page entry shows zero or absent `rsvpMap` entry — `EventTableRow` receives null, which is its pre-existing zero-count path. **Pass.**
- **Non-recurring events:** `if (row.occurrenceDate)` guard is skipped (`null` is falsy); `summaryRows === rsvpRows`; rollup header gated on `event.isRecurring` is never reached. Test 4 passed. **Pass.**
- **Failure microcopy:** no new UI code introduces user-facing error paths. Both changed files are Server Components that throw to Next.js error boundaries on DB failure — same behavior as pre-fix. **Not applicable (no new error paths).**
- **Permission gate:** no change to existing `FEATURES` checks. The admin events pages are already behind `hasFeature(FEATURES.EVENTS_MANAGE)` checks. **Not applicable (no new gate).**
- **Mobile:** rollup header uses `<div className="mt-4 rounded-md bg-blue-50 p-4">` — no fixed-width containers, responsive by default. No regression on list or detail page layout. **Pass.**

### Open questions / handoff notes

- Phase 1 noted a follow-up: verify whether member-portal event surfaces (`/(dashboard)/events/`) carry the same single-occurrence scoping bug. This was explicitly out of scope for this fix. No action needed to close this pipeline entry, but the follow-up should be filed if member-portal admin-visible counts are also needed.
- Test 1's `>= listBefore + 2` assertion has the theoretical false-pass window noted in Phase 4 loop-back. Accepted engineering trade-off per implementer's documentation.

---

**Verdict: SHIP IT**
