# B-46 — Consolidate the Copy-Pasted Scaffolding Around Every Email Send — Work Log

> **Slug:** `2026-09-11-b46-email-compose-consolidation`
> **Surface:** mixed (`src/lib/` + API route handlers that send email)
> **Permission(s):** none — no new permission surface, purely internal refactor
> **Estimated complexity:** medium (mechanical, but ~20 files touched)
> **Pipeline mode:** Accelerated — Phase 1 (analyst) and Phase 2 (architect) deliberately skipped

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | **Skipped** | — | 2026-09-11 |
| 2 — Architectural review | architect | **Skipped** | — | 2026-09-11 |
| 3 — Technical design | (embedded in task brief) | Complete | N/A | 2026-09-11 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-11 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Skip rationale (no silent skips)

**Phase 1 (analyst) skipped.** There is no user-facing behavior to refine — this is an
internal duplication-consolidation pass with one deliberate, narrow exception (the app-URL
fallback shape, already agreed as a fix in the 2026-09-10 code review, HIGH-1).

**Phase 2 (architect) skipped.** The module's shape and home (`src/lib/email-compose.ts`,
owning from-address/app-URL/escaping) were already ruled by the B-46 backlog entry
(`docs/backlog.md`) alongside direct precedent — `src/lib/html-escape.ts` and
`src/lib/club-contacts.ts` are the same "small pure module, no DB coupling" pattern already
in the codebase. No new directory, no new dependency, no structural question requiring
architect judgment.

**Phase 3 (tech-lead) — no separate design doc.** The task brief that launched this work
(reproduced in full in the request) already specified: the module's exported surface
(`getFromEmail`, `getAppUrl`, re-exported `escapeHtml`), the exact from-address and app-URL
fallback shapes to standardize on, the decision to keep the stricter 5-char escape set
(including `'` → `&#39;`), and the required test matrix. That brief functioned as the Phase 3
design; a separate tech-lead pass would have reproduced it. Noted here rather than silently
treating Phase 3 as absent.

---

# Phase 4 — Implementation (API) — 2026-09-11

**Owner:** api-developer
**Status:** complete

### Summary

Created `src/lib/email-compose.ts`, exporting `getFromEmail(displayName?)`, `getAppUrl()`,
and a re-exported `escapeHtml`. Migrated all 21 in-scope call sites (14 route handlers + 3
library files with local escapers/URLs + 4 more library files needing only the from/URL
helpers) onto the shared module, deleting every local `esc()`/`escapeHtml()` copy and every
inline `process.env.RESEND_FROM_EMAIL ?? "..."` / `process.env.NEXTAUTH_URL ?? "..."`
duplicate within scope. Strengthened the canonical `escapeHtml()` in `src/lib/html-escape.ts`
to a 5-character escape set (added `'` → `&#39;`), per the review's explicit recommendation,
since two of the three local copies already escaped apostrophes and one is the stricter,
safer choice to standardize on. Wrote a full unit-test suite for the new module and updated
the two existing test files whose behavior moved (`proposals.test.ts`, `html-escape.test.ts`).

### What I did

- Read `docs/backlog.md`'s B-46 entry and `docs/reviews/2026-09-10-code.md` HIGH-1 in full
  before starting, to get the exact call-site inventory and the recommended fix shape.
- Audited every `RESEND_FROM_EMAIL` and `NEXTAUTH_URL` reference in `src/` and every local
  HTML-escaper implementation, confirming the review's counts against the current tree.
- Built `src/lib/email-compose.ts` (pure module, no DB import, mirrors
  `src/lib/club-contacts.ts`'s "stay importable everywhere" precedent) re-exporting the
  existing `escapeHtml` from `src/lib/html-escape.ts` rather than duplicating it.
- Strengthened `src/lib/html-escape.ts`'s `escapeHtml()` to escape `'` as `&#39;` (5th
  character), matching `dues-reminders.ts`'s and `ledger-acknowledgment-letter.ts`'s prior
  local copies — the stricter of the two disagreeing shapes the review found.
- Migrated 21 files (full list in Outputs) onto `getFromEmail()` / `getAppUrl()` /
  `escapeHtml` from the shared module, deleting every local copy: 3 `esc()` closures
  (contact, suggestions, membership-applications routes), 1 in auth/index.ts, the local
  `escapeProposalHtml()` in `proposals.ts`, and the local `escapeHtml()` in
  `dues-reminders.ts` and `ledger-acknowledgment-letter.ts`.
- Standardized every in-scope app-URL site onto the trailing-slash-trimmed,
  absolute-fallback shape (`getAppUrl()`), replacing the three disagreeing shapes found
  (`?? ""`, bare interpolation with no fallback, and the one already-correct
  `?.replace(/\/$/, "") ?? "https://westervillelions.org"` shape).
- Wrote `src/lib/email-compose.test.ts` (14 tests: from-address with/without env var and
  with/without display name, app-URL with/without trailing slash/unset, escaping applied).
- Updated `src/lib/html-escape.test.ts` (added an apostrophe-escaping assertion) and
  `src/lib/proposals.test.ts` (removed the now-redundant `escapeProposalHtml` describe block,
  since that coverage lives in `html-escape.test.ts` now).
- Ran `pnpm exec tsc --noEmit`, `pnpm test` (full suite), and `pnpm lint` after the full
  migration — all clean (typecheck 0 errors, 1955/1955 tests passed across 104 files, lint 0
  errors / 1 pre-existing unrelated warning).

### Outputs

**New module:** `src/lib/email-compose.ts`
- `getFromEmail(displayName?: string): string` — `process.env.RESEND_FROM_EMAIL ??
  "noreply@westervillelions.org"`, optionally wrapped as `"Display Name <address>"`.
- `getAppUrl(): string` — `process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
  "https://westervillelions.org"`. Never returns `""`.
- `escapeHtml` — re-exported from `@/lib/html-escape` (unchanged export, now also imported
  here so a send site needing all three has one import).

**New tests:** `src/lib/email-compose.test.ts` (14 tests, all passing).

**Modified library files (from-address/app-URL/escaping consolidated):**
- `src/lib/html-escape.ts` — `escapeHtml()` now escapes `'` → `&#39;` (5th character).
- `src/lib/html-escape.test.ts` — added apostrophe-escaping test coverage.
- `src/lib/proposals.ts` — deleted local `escapeProposalHtml()`.
- `src/lib/proposals.test.ts` — removed the now-redundant `escapeProposalHtml` test block.
- `src/lib/dues-reminders.ts` — deleted local `escapeHtml()`, imports from
  `@/lib/html-escape`.
- `src/lib/ledger-acknowledgment-letter.ts` — deleted local `escapeHtml()`, imports from
  `@/lib/html-escape`.
- `src/lib/ledger-acknowledgment-letter-queries.ts` — `logoUrl` now built from `getAppUrl()`
  instead of `process.env.NEXTAUTH_URL || "https://westervillelions.org"`.
- `src/lib/members.ts` — `sendWelcomeEmail()` now uses `getFromEmail("Westerville Lions
  Club")` / `getAppUrl()`.
- `src/lib/auth/index.ts` — unlinked-user admin alert now uses `getFromEmail("Westerville
  Lions Portal")` / `escapeHtml`.

**Modified route handlers (14 files, all now import `getFromEmail`/`getAppUrl`/`escapeHtml`
from `@/lib/email-compose` in place of inline `process.env...` fallbacks and/or local `esc()`
closures):**
- `src/app/api/contact/route.ts`
- `src/app/api/suggestions/route.ts`
- `src/app/api/membership-applications/route.ts`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/admin/minutes/[id]/email/route.ts`
- `src/app/api/admin/events/[id]/announce/route.ts` (kept its local `siteUrl()` name as a
  thin alias — `const siteUrl = getAppUrl;` — to avoid touching 4 call sites)
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts`
- `src/app/api/admin/ledger/transactions/route.ts` (2 send sites: disbursement approval,
  transfer/sweep approval)
- `src/app/api/admin/proposals/[id]/decide/route.ts`
- `src/app/api/admin/social-requests/[id]/decide/route.ts`
- `src/app/api/admin/dues/reminders/route.ts` (app-URL only — `fromEmail` is deliberately
  the fixed `treasurer@westervillelions.org` alias, out of scope, see below)
- `src/app/api/members/reimbursements/route.ts`
- `src/app/api/members/proposals/[id]/submit/route.ts`
- `src/app/api/members/social-requests/[id]/submit/route.ts`

No schema changes. No new `FEATURES` key. No change to `sendEmail()` /
`sendBulkMemberEmail()` or the non-production guardrail in `src/lib/email.ts` — verified by
running the existing `src/lib/email-guardrail.test.ts` (17 tests) unmodified and green both
before and after this change.

### Before / after duplication counts

| Duplicated pattern | 2026-08-12 | 2026-09-10 review | After this pass |
|---|---|---|---|
| `RESEND_FROM_EMAIL` fallback | 12 | 15 | **0** (all 15 in-scope sites migrated to `getFromEmail()`) |
| `NEXTAUTH_URL` fallback (email-send sites only) | 8 | 19 total (13 of which were email-send sites, within this task's scope) | **0** in-scope sites remain (13 migrated to `getAppUrl()`) |
| HTML escaper implementations | 6 | 4 (2 shapes) | **1** (`escapeHtml` in `html-escape.ts`, 5-char set, re-exported by `email-compose.ts`) |

The remaining ~6 `NEXTAUTH_URL` sites the 2026-09-10 review counted toward its "19" are
**not** email-send sites — 4 public/member event pages building calendar URLs
(`src/app/events/page.tsx`, `src/app/events/[id]/page.tsx` ×2, `src/app/members/events/page.tsx`)
and `src/app/api/events/[id]/ics/route.ts` (a calendar-file download route, not an email
send). Per this task's explicit scope (`src/lib/` and the API routes/libs that send email),
these were deliberately left untouched. They still duplicate the same trim-and-fallback
shape (already correct in all 5 cases — `?? "https://westervillelions.org"`, missing only the
trailing-slash trim) and are a reasonable candidate for a follow-up backlog item, but
migrating them wasn't in scope and risked stepping on a concurrent agent's changes to
`src/app/events/`-adjacent files.

### Call sites whose behavior changed, and why

1. **`escapeHtml()` now escapes `'` as `&#39;` everywhere** (previously only in
   `dues-reminders.ts` and `ledger-acknowledgment-letter.ts`; the other ~10 call sites used
   the 4-char set). This is a **strictly additive** escape — an HTML entity `&#39;` renders
   identically to a raw `'` in any text-node context, which is where every one of these values
   is interpolated (none land inside a single-quoted HTML attribute). No call site's rendered
   output changes for a human reader; the underlying markup is more defensively encoded. This
   was the review's explicit recommendation ("keep `'` → `&#39;`, the stricter of the two,
   since it's already proven safe in two features").
2. **App-URL fallback standardized to trailing-slash-trimmed + absolute** at 9 sites that
   previously used `process.env.NEXTAUTH_URL ?? ""` (both `admin/ledger/reimbursements/[id]`,
   both `admin/ledger/transactions` inline builders, `admin/dues/reminders`,
   `admin/social-requests/[id]/decide`, `admin/proposals/[id]/decide`,
   `members/reimbursements`, `members/social-requests/[id]/submit`,
   `members/proposals/[id]/submit`). Previously, if `NEXTAUTH_URL` were ever unset, these
   emails would have carried a root-relative link (e.g. `/admin/ledger/approvals`) — broken
   in any mail client. Now they carry the absolute production URL as a fallback. This is the
   documented fix the backlog item and review both call for, not an incidental change.
3. **`src/app/api/auth/forgot-password/route.ts`'s `from` address** changed from a hardcoded
   literal `"Westerville Lions <noreply@westervillelions.org>"` to
   `getFromEmail("Westerville Lions")`, which resolves to
   `` `Westerville Lions <${process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"}>` ``.
   **Behavior is identical today** (no deploy sets `RESEND_FROM_EMAIL` to anything other than
   the fallback), but if it were ever set differently, password-reset emails would now respect
   it like every other send site, instead of silently using a different address. This route
   was not one of the review's 15 counted from-address sites (it never used the pattern at
   all) — bringing it in line was a judgment call in this pass, made because leaving one
   email-send site permanently deaf to `RESEND_FROM_EMAIL` while consolidating every other one
   onto it seemed like the wrong kind of "no behavior change." Flagging explicitly per the
   task brief's instruction to call out any behavior change.
4. **`src/lib/ledger-acknowledgment-letter-queries.ts`'s `logoUrl`** changed from
   `` process.env.NEXTAUTH_URL || "https://westervillelions.org" `` (note: `||`, not `??`) to
   `getAppUrl()`. Functionally near-identical — the only case where `||` and `??` diverge is
   `NEXTAUTH_URL=""` (empty string), which `||` would treat as falsy and fall back correctly,
   same as `??` would for `undefined`. The one real change is the trailing-slash trim, which
   `getAppUrl()` adds and the old code didn't — if `NEXTAUTH_URL` had a trailing slash, the old
   code would have produced `.../images/logo-official.png` with a doubled slash
   (`https://x.org//images/...`); `getAppUrl()` fixes that too.
5. **`src/app/api/admin/dues/reminders/route.ts`'s `membersDuesUrl`** changed from `` `${process.env.NEXTAUTH_URL ?? ""}/members/dues` `` to `` `${getAppUrl()}/members/dues` `` — same
   empty-string-to-absolute-fallback fix as item 2. This route's `fromEmail` (the treasurer@
   alias) was deliberately left untouched — see "Deliberately left duplicated" below.

Every other migration (the remaining ~13 from-address sites, the escaper-only sites, and
`admin/events/[id]/announce/route.ts`'s `siteUrl()` — which already had the correct shape) is
a pure rename with byte-identical runtime behavior.

### Tests added

- `src/lib/email-compose.test.ts` — 14 tests covering:
  - `getFromEmail()`: unset env var (fallback), set env var, with/without display name
    wrapper, wrapping the configured (not fallback) address.
  - `getAppUrl()`: unset (absolute fallback), trailing slash trimmed, no trailing slash
    unchanged, never returns `""`, safe to interpolate a path directly onto.
  - `escapeHtml` re-export: confirmed to be the same function as `html-escape.ts`'s, applies
    escaping to a realistic injection payload.
- `src/lib/html-escape.test.ts` — added one test asserting `'` is now escaped (apostrophe in
  ordinary prose, e.g. a possessive), alongside the existing 4-character coverage.
- `src/lib/proposals.test.ts` — removed the `escapeProposalHtml` describe block (4 tests) now
  that the function is gone; that coverage is superseded by `html-escape.test.ts`'s equivalent
  cases (anchor-tag neutralization, ampersand-first ordering, individual character escapes).

All 1955 tests across 104 files pass. `pnpm exec tsc --noEmit`: 0 errors. `pnpm lint`: 0
errors (1 pre-existing, unrelated warning in `budget-context-panel.tsx`, already documented
in the 2026-09-10 code review as a deliberately deferred item).

### Deliberately left duplicated (with justification)

- **`treasurer@westervillelions.org` as a fixed `from` address** in
  `src/app/api/admin/dues/reminders/route.ts` and `src/lib/ledger-acknowledgment-letter-queries.ts`
  (`EMAIL_FROM` constant). Neither uses the `RESEND_FROM_EMAIL` fallback pattern — both are a
  deliberate "signed by the treasurer position" identity, distinct from the general club
  from-address `getFromEmail()` owns. Consolidating these two would require deciding whether
  the treasurer's address should also live in `email-compose.ts`, which is a different design
  question (a *third* well-known address, alongside `CLUB_GROUP_EMAIL`/`BOARD_EMAIL` in
  `club-contacts.ts`) than this task's from-address/app-URL/escaping scope. Left as-is; if a
  third treasurer-signed send site appears, `resolveTreasurer()`'s existing home
  (`src/lib/board-positions.ts`) or `club-contacts.ts` looks like the more natural place for
  it, not `email-compose.ts`.
- **4 public/member event pages + 1 ICS download route** still duplicate the app-URL
  trim-and-fallback shape (already correct in all 5, just missing the trailing-slash trim).
  Out of scope per this task's brief (not email-send sites); see "Before/after" table above.
- **`escapeIlikeTerm`** (2 copies, `ledger.ts` + `minutes.ts`) — a different escaper for a
  different purpose (SQL `ILIKE` wildcard escaping, not HTML). Already reviewed and
  explicitly justified in the 2026-09-10 code review's LOW-1 finding (minutes deliberately
  shares no module dependency with the Ledger). Not touched, not in scope.
- **`escapeMarkdownValue`** in `ledger-acknowledgment-letter.ts` — a Markdown-token escaper
  for the acknowledgment-letter template substitution, unrelated to HTML escaping. Not
  touched.

### Open questions / handoff notes

- **Next agent: qa**, for Phase 5 verification. Suggest spot-checking at least one email body
  from each migrated category in a dev send (respecting `EMAIL_DEV_ALLOWLIST` — never send to
  a real member or distribution list) to visually confirm an apostrophe-containing value
  (e.g. a proposal's `needDescription` or a contact-form message with a possessive) still
  renders as a plain apostrophe in an actual mail client, not as a literal `&#39;` — the unit
  tests confirm the HTML source is correct but don't render it.
- No UI work resulted from this change (pure backend/library refactor); no `ux-developer`
  handoff needed.
- `docs/backlog.md`'s B-46 entry can be closed once qa signs off, using the before/after
  counts in this work-log as the closing evidence. The entry's own text already names
  `src/lib/email-compose.ts` as the target shape, which now exists.
- Flag for the next 30-day code review: consider a follow-up backlog item for the 5
  remaining non-email `NEXTAUTH_URL` sites (4 event pages + the ICS route) called out above —
  small, but the same shape of duplication, just outside this task's scope.
