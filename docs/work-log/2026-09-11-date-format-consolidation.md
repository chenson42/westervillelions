# Date-Formatter Consolidation (2026-09-10 Code Review, HIGH-1b) — Work Log

> **Slug:** `2026-09-11-date-format-consolidation`
> **Surface:** `src/lib/` (new shared module) + `src/components/**` (this pass) — `src/app/**`
> page-level call sites are out of scope for this pass, handled separately.
> **Permission(s):** none — no new permission surface, purely internal refactor
> **Estimated complexity:** medium (mechanical, ~30 files touched in this pass)
> **Pipeline mode:** Accelerated — Phase 1 (analyst) and Phase 2 (architect) deliberately skipped

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | **Skipped** | — | 2026-09-11 |
| 2 — Architectural review | architect | **Skipped** | — | 2026-09-11 |
| 3 — Technical design | (embedded in task brief) | Complete | N/A | 2026-09-11 |
| 4 — Implementation (UI + shared lib) | ux-developer | Complete | — | 2026-09-11 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Skip rationale (no silent skips)

**Phase 1 (analyst) skipped.** No user-facing behavior changes except the two genuine bug
fixes called out below (both explicitly flagged, not silently absorbed) — this is an internal
duplication-consolidation pass directly following the 2026-09-10 code review's HIGH-1b
finding.

**Phase 2 (architect) skipped.** Module shape and home (`src/lib/date-format.ts`-style pure
module, no DB coupling) were already specified by the review's own recommendation and mirror
direct precedent already in the codebase (`src/lib/html-escape.ts`, `src/lib/fiscal-year.ts`).
No new directory, no new dependency.

**Phase 3 — no separate design doc.** The task brief that launched this work specified the
exact two-function surface (`formatCalendarDate` / `formatTimestamp`, split on `date` vs
`timestamp` column semantics), the required `TZ=Pacific/Midway` regression-guard test pattern
(precedented in `src/lib/minutes-queries.test.ts`), and the standard that rendered output must
not change except for explicitly-listed bug fixes. That brief functioned as the Phase 3
design.

---

# Phase 4 — Implementation (UI) — 2026-09-11

**Owner:** ux-developer
**Status:** complete

### Summary

Created `src/lib/format-date.ts`, exporting `formatCalendarDate()`, `formatTimestamp()`, and
`parseCalendarDate()`. Migrated every local date formatter within `src/components/**` and
`src/lib/` (excluding `src/app/api/**` and `src/lib/email*.ts`, owned by a concurrent agent)
onto the shared module — 28 call-site files, ~31 individual duplicate-formatter copies
deleted. Found and fixed two real, previously-shipped rendering bugs (both use
`getFiscalYear(new Date(rawDateString))` on a `date`-column string, the exact naive-UTC bug
class this module exists to prevent) and left several genuinely bespoke formatters untouched,
each with an inline comment explaining why.

### What I did

- Read the api-developer's parallel work-log (`2026-09-11-b46-email-compose-consolidation.md`)
  to confirm scope boundaries (`src/app/api/**` and `src/lib/email*.ts` are that agent's
  files, not mine) before touching anything.
- Inventoried every local date formatter under `src/components/**` and `src/lib/` via
  `toLocaleDateString`/`Intl.DateTimeFormat`/`formatDate`/`formatYMD` greps, then traced each
  call site's data source back to `src/lib/db/schema.ts` to classify it as calendar-date
  (`date(...)` column) or instant (`timestamp(...)` column / computed `Date`).
- Built `src/lib/format-date.ts`: `parseCalendarDate(dateStr)` (explicit local
  `new Date(y, m-1, d)` construction), `formatCalendarDate(dateStr, style)` built on it, and
  `formatTimestamp(d, style)` (lets `Date` parse — correct for real instants). `style` is
  `"short" | "long" | "full"` (`"full"` adds the weekday, needed by
  `minutes-detail.tsx`'s meeting-date heading — the third format shape found in the audit,
  beyond the two the task brief named).
- Migrated 28 files onto the shared functions (full list below), deleting each local
  `formatDate`/`formatYMD`/`formatMeetingDate`/`formatSubmittedDate`/`formatOccurrenceDate`
  implementation. Several were byte-identical across 4-6 files (the reconciliation panel
  family, the `Date | string` timestamp-formatter family) and collapsed to a single shared
  import each.
- **Found and fixed two real bugs**: `uncashed-checks-panel.tsx` and
  `unremitted-deposits-panel.tsx` both computed `getFiscalYear(new Date(row.txnDate))` where
  `row.txnDate` is a raw `'YYYY-MM-DD'` string from a `date` column — the exact
  naive-timestamp-as-UTC bug this module exists to prevent, just feeding a fiscal-year
  computation instead of a display string. A check or deposit dated exactly July 1 could
  misfile into the prior fiscal year's aging panel in any US timezone. Fixed both to use
  `parseCalendarDate(row.txnDate)`, with an inline comment at each site.
- Left several formatters deliberately un-migrated, each with a reason (see "Deliberately
  left duplicated" below): `financial-report-ui.ts`'s month/year label helpers (different
  shape — no day component, input is `'YYYY-MM'` not `'YYYY-MM-DD'`), `monthly-statement-table.tsx`'s
  `shortDate()` (non-`toLocaleDateString` compact format, `"9/11/26"`), `minutes-editor-shell.tsx`'s
  one `toLocaleDateString()`-with-no-options call (would silently change rendered output —
  see below), and `event-announcement-history-table.tsx`'s `formatSentAt()` (includes
  hour:minute, a genuinely different shape from every other site).
- Wrote `src/lib/format-date.test.ts` (11 tests): both styles for each function, the `"full"`
  weekday style, a `TZ=Pacific/Midway` (UTC-11) regression guard proving `formatCalendarDate`
  is NOT reachable via a bare `new Date(dateStr)` (mirrors the pattern in
  `src/lib/minutes-queries.test.ts`), the mirror-direction guard under `Pacific/Kiritimati`
  (UTC+14), and a test documenting that `formatTimestamp` is *correctly* UTC-sensitive near
  midnight (the opposite property from `formatCalendarDate`, asserted explicitly so the two
  functions' different behavior is proven, not just implied by their names).
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm lint` after the full migration — all clean.

### Outputs

**New module:** `src/lib/format-date.ts`
- `parseCalendarDate(dateStr: string): Date` — explicit local construction from a
  `'YYYY-MM-DD'` string.
- `formatCalendarDate(dateStr: string, style?: "short"|"long"|"full"): string` — for `date`
  columns. Default `"short"` → `"Aug 8, 2026"`; `"long"` → `"August 8, 2026"`; `"full"` →
  `"Saturday, August 8, 2026"`.
- `formatTimestamp(d: Date | string, style?): string` — for `timestamptz`/genuine-instant
  `timestamp` columns, full ISO strings, and already-parsed `Date` objects. Same `style`
  options.

**New tests:** `src/lib/format-date.test.ts` (11 tests, all passing).

**Modified files — calendar-date sites (9), migrated to `formatCalendarDate`:**
- `src/components/admin/ledger/ack-queue.tsx`
- `src/components/admin/ledger/acknowledgment-letter-selector.tsx`
- `src/components/admin/ledger/reconciliation-create-from-bank-line-dialog.tsx`
- `src/components/admin/ledger/reconciliation-match-picker.tsx`
- `src/components/admin/ledger/reconciliation-matching-grid.tsx`
- `src/components/admin/ledger/reconciliation-session-list.tsx`
- `src/components/admin/ledger/sent-ack-list.tsx`
- `src/components/members/impact-by-cause.tsx` (`"long"` style)
- `src/components/admin/event-announcement-history-table.tsx` (`formatOccurrenceDate`)

**Modified files — calendar-date sites with a bug fix (2):**
- `src/components/admin/ledger/uncashed-checks-panel.tsx` — formatter migrated +
  `getFiscalYear(new Date(row.txnDate))` → `getFiscalYear(parseCalendarDate(row.txnDate))`.
- `src/components/admin/ledger/unremitted-deposits-panel.tsx` — same fix.

**Modified files — mixed calendar-date + instant (1):**
- `src/components/admin/ledger/filings-calendar.tsx` — `filing.filedOn` (raw `date` string)
  → `formatCalendarDate`; `filing.dueDate` (already-computed `Date`) → `formatTimestamp`.

**Modified files — "full" (weekday) style (1):**
- `src/components/minutes/minutes-detail.tsx` — `formatMeetingDate()` now delegates to
  `formatCalendarDate(dateStr, "full")`.

**Modified files — instant/timestamp sites (14), migrated to `formatTimestamp`:**
- `src/components/admin/admin-event-rsvp-table.tsx`
- `src/components/admin/occurrence-rsvp-section.tsx`
- `src/components/admin/documents/pending-versions-panel.tsx` (`"long"`, 2 call sites:
  `createdAt`, `adoptedAt`)
- `src/components/admin/dues-reminder-sender.tsx`
- `src/components/admin/proposals/proposal-review-table.tsx` (nullable wrapper retained)
- `src/components/admin/social-requests/social-request-review-table.tsx` (nullable wrapper
  retained)
- `src/components/documents/document-view.tsx` (`"long"`)
- `src/components/documents/version-history-list.tsx` (`"long"`)
- `src/components/members/proposal-status-timeline.tsx` (`"long"`)
- `src/components/members/social-request-status.tsx` (`"long"`)
- `src/components/members/proposal-form.tsx` (`"long"`, "Not yet submitted" null-guard
  retained)
- `src/components/members/social-request-form.tsx` (`"long"`, same null-guard)
- `src/components/admin/ledger/donor-list.tsx` (nullable `"—"` wrapper retained)
- `src/components/admin/ledger/acknowledgment-letters-print.tsx` (`new Date()` "today", `"long"`)

**Modified files — `src/lib/`:**
- `src/lib/financial-report-queries.ts` — deleted the private `parseYMD()`/`formatMonthEndLabel()`
  duplicate pair; `formatMonthEndLabel` now delegates to `formatCalendarDate(monthEnd, "long")`,
  and the two `getFiscalYear(parseYMD(...))` call sites now use `parseCalendarDate`.
- `src/lib/ledger-acknowledgment-letter.ts` — `formatGiftDate()` now delegates to
  `formatCalendarDate(txnDate, "long")`.
- `src/lib/ledger-queries.ts` — the one `row.updatedAt.toLocaleDateString(...)` call
  (budget-notes `updatedAtLabel`) now uses `formatTimestamp(row.updatedAt)`.

Total: **28 files migrated**, 2 of which also received the fiscal-year bug fix, for **31**
individual duplicate-formatter implementations removed.

### Bug found and fixed (flagged per the task's explicit instruction)

**`uncashed-checks-panel.tsx` and `unremitted-deposits-panel.tsx`** both called
`getFiscalYear(new Date(row.txnDate))`, where `row.txnDate` is a raw `'YYYY-MM-DD'` string
from a `date` column (confirmed against `ledgerTransactions.txnDate` in `schema.ts`). This is
the naive-timestamp-as-UTC bug class verbatim — `new Date("2026-07-01")` parses as UTC
midnight, which in any US timezone reads back as June 30 local. A check or unremitted deposit
dated exactly on the fiscal-year boundary (July 1) could therefore be attributed to the wrong
fiscal year's row grouping in these two admin panels. Neither the sibling
`ledger.ts:computeDuesTimingAdjustment()` nor any of the 31 migrated display formatters had
this bug — only these two `getFiscalYear()` call sites, which weren't formatters at all and so
weren't caught by the original per-file "mirrors formatDate() in X.tsx" comments the codebase
had been leaving on the *formatting* copies. Fixed both to `getFiscalYear(parseCalendarDate(row.txnDate))`,
with an inline comment at each site citing this consolidation pass.

### Deliberately left duplicated / un-migrated (with justification)

- **`src/lib/financial-report-ui.ts`** (`buildRecentMonthOptions`, `ensureMonthOption`) — both
  build a `"YYYY-MM"` → `"August 2026"` **month/year label** (no day component at all), a
  genuinely different shape from a calendar date. The file already carries an excellent doc
  comment explaining the local `new Date(y, m-1, 1)` construction and why it's UTC-safe. Not
  migrated — different input shape, would need a third exported function for two call sites
  in one file.
- **`src/components/members/monthly-statement-table.tsx`**'s `shortDate()` — renders
  `"9/11/26"` via manual string interpolation, not `toLocaleDateString`. A genuinely different,
  bespoke compact format (explained in-file as deliberately mirroring the admin fund-report
  page's own established convention). Already correct (splits before constructing). Left
  alone.
- **`src/components/admin/minutes/minutes-editor-shell.tsx`**'s one
  `new Date(approvedAt).toLocaleDateString()` (no options) — this is the only site in the
  codebase calling `toLocaleDateString()` with no arguments, which renders the browser/runtime
  locale-default numeric format (e.g. `"9/11/2026"`), not the `"Sep 11, 2026"` shape
  `formatTimestamp` produces. Migrating it would have been the one place in this pass where
  the rendered string silently changed with no bug being fixed — which the task explicitly
  forbids. Left as the original inline call, with a comment explaining why.
- **`src/components/admin/event-announcement-history-table.tsx`**'s `formatSentAt()` — formats
  with `hour`/`minute` in addition to the date (`toLocaleString`, not `toLocaleDateString`), a
  genuinely different, single-site shape. Left local, with a comment.
- **`src/lib/financial-report-queries.test.ts`**'s own local `parseYMD()` (test-only) — an
  independently-written duplicate of the same parse used to verify
  `getFiscalYear(parseCalendarDate(...))` behaves correctly; kept deliberately independent so
  a bug shared between the module and its test wouldn't be invisible to the test. Test-only,
  not part of the review's 37/38-file production-code count.
- **Arithmetic helpers that superficially resemble formatters but aren't** —
  `ledger-queries.ts`'s `addOneDayToYMD()`/`parseYMD()` (function-scoped, inside
  `getPhilanthropy()`), `ledger.ts`'s `computeDuesTimingAdjustment()`'s inline split-parse
  (already correctly uses split parts, not a bare string, confirming the *other* two sites'
  bug rather than sharing it), and `reconciliation.ts`'s `daysBetweenUTC()`. Each does date
  *arithmetic* (day-add, day-diff, FY-from-parts), not display formatting, each already
  UTC-safe, and each carries its own doc comment justifying why it isn't shared. Consolidating
  these would be a different, separate finding from HIGH-1b (which is specifically about
  formatters) and risks conflating genuinely different semantics under one helper.
- **`src/app/**` page-level call sites** (the review's other ~6-7 files: `members/dues/page.tsx`,
  `members/impact/page.tsx`, `admin/ledger/approvals/page.tsx`, `admin/dues/[memberId]/page.tsx`,
  `members/social-requests/[id]/page.tsx`, `admin/social-requests/[id]/page.tsx`, plus the
  ~21 timestamp-only copies the review counted but didn't individually name) — **explicitly
  out of scope** for this pass per the task brief (`src/components/**` and `src/lib/` only,
  `src/app/**` reserved for a separate/concurrent pass). `src/lib/format-date.ts` is ready to
  import from any of them.

### Tests added

`src/lib/format-date.test.ts` — 11 tests:
- `formatCalendarDate`: default (short) style, `"long"` style, `"full"` (weekday) style.
- `formatCalendarDate` regression guards: renders the same calendar day under
  `TZ=Pacific/Midway` (UTC-11) and `TZ=Pacific/Kiritimati` (UTC+14) — the two opposite-direction
  failure modes a bare `new Date(dateStr)` would produce.
- `parseCalendarDate`: returns the correct local y/m/d, including under the hostile
  `Pacific/Midway` TZ, at exactly the fiscal-year boundary (`2026-07-01`) — the same case the
  two bug-fix sites now depend on.
- `formatTimestamp`: default style, `"long"` style, accepts an already-parsed `Date` directly,
  and a documented test asserting the function is *correctly* UTC-sensitive near midnight
  under `Pacific/Midway` — proving `formatTimestamp` and `formatCalendarDate` have genuinely
  different, both-correct behavior for their respective inputs.

`pnpm test`: 104 files, 1955 tests, all passing (11 new + 1933 baseline + api-developer's
concurrent additions). `pnpm exec tsc --noEmit`: 0 errors. `pnpm lint`: 0 errors, 1
pre-existing unrelated warning (`budget-context-panel.tsx`, already documented in the
2026-09-10 review as deliberately deferred).

### Open questions / handoff notes

- **Next agent: qa**, for Phase 5 verification. Suggest spot-checking in the browser:
  `/admin/ledger/approvals` (uncashed checks / unremitted deposits panels — confirm a
  July-1-dated row groups into the correct fiscal year now), `/members/proposals`,
  `/members/social-requests`, `/members/records/documents/[slug]`, and `/admin/club-files`
  (governing-document version history dates) for visually correct, unchanged date rendering.
- No new copy strings — every migrated site renders identically to before, except the two bug
  fixes (which change which fiscal-year group a July-1-dated row appears under, not any
  visible date string).
- `src/app/**` page-level call sites (list above) remain for a follow-up pass — flagging for
  whichever agent picks up the app/ directory next, since `src/lib/format-date.ts` already
  exists and is ready to import.
- Consider filing a backlog item for the arithmetic-helper family noted under "Deliberately
  left duplicated" (`addOneDayToYMD`, the two `parseYMD` computation-only copies, `daysBetweenUTC`)
  if a future review wants to look at that separately from formatting — not urgent, all are
  already UTC-safe.
