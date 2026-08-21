# Sent Acknowledgments Are Invisible — Work Log

> **Slug:** `2026-08-12-sent-acknowledgments-view`
> **Surface:** (dashboard) admin — The Ledger / Donors & Acknowledgments
> **Permission(s):** existing `ledger.record`
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | see below | 2026-08-12 |
| 2 — Architectural review | architect | Skipped | see below | 2026-08-12 |
| 3 — Technical design | tech-lead | Skipped | see below | 2026-08-12 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-12 |
| 5 — Verification | qa | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-18 |

**Phases 1–3 skipped** (bug-fix variant): the defect is understood, one-surface, and touches no
invariant. Root cause and reproduction are below, per the rule that even a trivial fix gets a stub.

---

## The bug

Reported by the treasurer: *"i can't seem to link a donor now. they are marked acknowledged."*

**Reproduction:** mark an acknowledgment sent, then try to link a donor to it from
`/admin/ledger/donors`. The row is gone.

**Root cause.** The Donors & Acknowledgments page has exactly two tabs, **Donors** and **Pending
Acknowledgments**, and the second is backed by `listPendingAcknowledgments()`, which filters to
`sentAt IS NULL`. There is no view of sent acknowledgments anywhere in the app. A sent
acknowledgment therefore disappears from the only screen where a donor would naturally be linked
to it.

**Not the cause, ruled out by checking:** none of the three guards on
`PATCH /api/admin/ledger/transactions/[id]` (approved, rejected, reconciliation-locked) apply —
verified against production, zero of the affected rows hit any of them. The API would accept the
link; the UI simply never offers the row.

**Why it surfaced now.** On 2026-08-09 a one-off script closed out every historical acknowledgment
dated 2026-03-07 or earlier at the treasurer's request. It marked **49 acknowledgments sent
without linking a donor to any of them**, and they all vanished from the pending tab at once.
Production now holds 50 acknowledgments, 49 sent, 49 with no donor. That script created the
conditions; the missing view is the actual defect and would have bitten eventually regardless.

**Second-order problem, tracked separately:** an acknowledgment with no donor cannot produce a
letter and cannot feed a 990 Schedule B entry. The 49 need donors attached — see the companion
matching script.

## Workaround while unfixed

The Link Donor action also renders on transaction rows in the fund register
(`/admin/ledger/[fundSlug]`), which has no such filter.

---

## Phase 4 — Implementation (full-stack) — 2026-08-12

**Owner:** full-stack-developer
**Status:** complete

### Summary

Added a third tab, **Sent Acknowledgments**, to `/admin/ledger/donors` alongside
**Donors** and **Pending Acknowledgments**. It lists every acknowledgment with
`sentAt` set, shows per-row whether a donor is linked (an obvious amber "No
donor linked" badge, plus a page-level amber banner tallying how many rows are
missing one), shows `sentVia` (Emailed / Printed / Unknown), and offers the
same `LinkDonorDialog`/`TxnDonorActions` Link Donor control already used on
the fund register — no second implementation.

### Shape chosen and why

A third tab, not a filter toggle on the existing "Pending Acknowledgments"
tab. The page already uses tabs as its idiom (Donors / Pending
Acknowledgments), and pending vs. sent are genuinely different queues with
different actions available (pending rows can be acknowledged or marked
sent; sent rows can only be linked/re-linked to a donor and viewed) — folding
them into one filterable list would have meant one component juggling two
action sets. A tab keeps `AckQueue` (pending) and the new `SentAckList` (sent)
each simple and single-purpose, matching how Donors/Pending Acknowledgments
are already split. No count badge on the new tab's label, matching the
existing "Donors" tab (only "Pending Acknowledgments" carries one) and
avoiding an extra unconditional query on every page load — `sentAcks` is only
fetched when `activeTab === "sent"`, mirroring how `donors` is only fetched
on the Donors tab.

### What I did

- Extended `listAcknowledgmentsSummary()` in `src/lib/ledger-queries.ts` with
  a `sentOnly` option (`sentAt IS NOT NULL`) alongside the existing
  `pendingOnly`, and added `sentVia` to `AcknowledgmentSummaryRow`. Did not
  touch `listPendingAcknowledgments()` or its WHERE clause — the pending
  tab's count badge is unaffected.
- Built `SentAckList` (`src/components/admin/ledger/sent-ack-list.tsx`), a
  client component rendering the sent-ack table: Date / Entity-Fund / Donor
  (link or "No donor linked" badge) / Amount / Sent (via badge) / Action
  (`TxnDonorActions` with `ackStatus="sent"`, which renders Link Donor /
  Re-link plus a static "Ack sent" indicator — no stray Acknowledge or Mark
  Sent controls since the row is already both acknowledged and sent). A
  page-level amber banner summarizes "N of M sent acknowledgments have no
  donor linked" when the count is nonzero. Empty state follows the
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention.
- Wired the tab into `src/app/(dashboard)/admin/ledger/donors/page.tsx`:
  `TabParam` gained `"sent"`, `sentAcks` is loaded conditionally
  (`listAcknowledgmentsSummary({ sentOnly: true, includePii: canRecord })`),
  and the tab renders `<SentAckList>`. `canRecord` is already guaranteed true
  for the whole page (the page redirects otherwise), so `includePii` is
  always safe to set from it.
- Added a unit-test suite in `src/lib/ledger-queries.test.ts`
  (`describe("listAcknowledgmentsSummary — sentOnly filter")`, 5 cases): the
  compiled WHERE is `sent_at IS NOT NULL` for `sentOnly`, `pendingOnly` wins
  and still compiles `IS NULL` when both flags are passed, no flags issues no
  filter condition, `sentVia` passes through per row for `'email'`, `'print'`,
  and legacy `null`, and PII fields are correctly omitted when `includePii`
  is false even on a sent+donor-linked row. Mirrors the existing
  `listPendingAcknowledgments` test patterns in the same file (mocked `db`,
  `PgDialect().sqlToQuery()` to inspect the compiled WHERE).

### A real bug this surfaced (not mine to fix — already landed concurrently)

Manually exercising Link Donor from the new tab (seeded 3 sent acks in the
dev DB — donor+email, no-donor+print, no-donor+legacy-null-sentVia — via a
throwaway, DATABASE_URL-only script, deleted after) found that
`PATCH /api/admin/ledger/transactions/[id]` only ever wrote
`ledger_transactions.donor_id`, never `ledger_acknowledgments.donor_id` — so
"linking a donor" from *any* screen (this new tab, or the pre-existing fund-
register workaround) looked successful but the acknowledgment itself, which
is what the letter generator and (per this file's own root-cause section) the
990 Schedule B feed actually read from, stayed donor-less. My first test
PATCH reproduced this exactly (transaction updated, `SentAckList` still
showed "No donor linked"). While I was diagnosing it, another in-flight
change to `src/app/api/admin/ledger/transactions/[id]/route.ts` landed in the
same working tree (unstaged, not authored by me — see that file's own
`donorLinkChanged` comment, dated 2026-08-12) that syncs both columns inside
one `db.transaction()`, mirroring what the acknowledge-creation route already
did. Re-running the same PATCH against the updated route confirmed the fix:
the acknowledgment's own `donor_id` updated and the row correctly dropped out
of the "no donor" count. I did not author or touch that route file — flagging
it here because my Phase 4 click-through depended on it, and because without
it "Offer the Link Donor action on those rows" would have been cosmetic
rather than functional for already-created acknowledgments, which is the
scenario the 49 production rows are actually in.

### Outputs

- `src/lib/ledger-queries.ts` — `listAcknowledgmentsSummary()` gained
  `sentOnly` option; `AcknowledgmentSummaryRow` gained `sentVia`.
- `src/components/admin/ledger/sent-ack-list.tsx` — new client component.
- `src/app/(dashboard)/admin/ledger/donors/page.tsx` — third tab wired in.
- `src/lib/ledger-queries.test.ts` — 5 new unit tests for the `sentOnly`
  filter and `sentVia`/PII passthrough.
- No schema change (`sent_via` already existed), no new `FEATURES` key
  (reuses `LEDGER_RECORD`, already gating the page), no new env var.

### Verify

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 1471 passed (up from 1466; +5 for this change). One transient
  run mid-session showed 2 failures in `ledger-acknowledgment-letter-queries.test.ts`
  from the concurrent, unrelated in-flight edit described above; re-run once
  that edit settled and it was back to 1471/1471 green — not a regression
  from this change (confirmed: my own two test files pass in isolation
  throughout).
- `pnpm build:only` — clean production build.
- Manual click-through on the existing dev server (port 3000; did not start a
  second instance — Next.js refused to run two dev servers against the same
  project directory, so I signed in via the `E2E_ADMIN_*` credentials in
  `.env.local` with a scripted NextAuth credentials POST + cookie jar and
  drove the pages with `curl`):
  - Seeded 3 acknowledgments directly in the dev DB (never touched
    `PROD_DATABASE_URL`): donor-linked+email, no-donor+print,
    no-donor+legacy-null-sentVia, against real Foundation income
    transactions that had no existing ack row.
  - `/admin/ledger/donors?tab=sent` showed all 3, correct Emailed/Printed/
    Unknown badges, "2 of 3 sent acknowledgments have no donor linked" banner,
    and "No donor linked" badges on the two donor-less rows.
  - Called the same `PATCH /api/admin/ledger/transactions/[id]` endpoint
    `LinkDonorDialog` calls to link a donor to one no-donor row — confirmed
    (after the concurrent fix above landed) that the row's donor now shows,
    the button changes to "Re-link", and the missing-donor banner updates to
    "1 of 3".
  - Deleted all 3 seeded acknowledgment rows and reset the one transaction's
    `donor_id` back to null; re-fetched the tab and confirmed it's back to
    the "No sent acknowledgments yet" empty state. Confirmed via direct DB
    query that no seeded rows remain.
  - Regression-checked all three tabs (`donors`, `acknowledgments`, `sent`)
    still return 200 after the change.

## Phase 5 — Verification (qa) — 2026-08-18

**Owner:** qa
**Status:** complete

### Summary

**PASS.** Full detail (automated gates, e2e failure classification, static code audit) lives in
the companion
[`2026-08-12-acknowledgment-letter-fixes.md`](2026-08-12-acknowledgment-letter-fixes.md) Phase 5
section — this pass covered all three related work-logs together against one shared working
tree. **Read the QA Integrity Note in the companion file before trusting anything else dated
2026-08-18** — an earlier, out-of-scope subagent produced a fabricated verification pass this
session, which was found (via direct-database contradiction) and fully redone from scratch.

### What I did

Automated gates: see companion file (tsc PASS, `pnpm test` 1523/1523 PASS, `pnpm build:only`
PASS/232 routes, `pnpm lint` FAIL-pre-existing-confirmed, e2e 93 passed/10 failed/34 did not run,
none touching this feature).

Static code audit: `listAcknowledgmentsSummary()`'s `sentOnly` option and the page wiring gate
through the existing `/admin/ledger/donors` page-level `auth()` + `hasFeature(...,
FEATURES.LEDGER_RECORD)` check (no new route, no new permission key — confirmed via `git diff
src/lib/permissions.ts`, empty). No native dialogs, no stray `console.log` in
`sent-ack-list.tsx` or the page wiring (part of the full-diff grep sweep in the companion file).

Manual click-through: run live against a real dev server (port 3000) through a real Playwright
browser session with an authenticated admin cookie, driving the real `/admin/ledger/donors?tab=sent`
page and the real `PATCH /api/admin/ledger/transactions/[id]` endpoint.

| Flow | Result | Notes |
|------|--------|-------|
| Sent tab lists a sent acknowledgment with no donor, shows the "No donor linked" badge | **PASS** | Confirmed via the real rendered page HTML after creating a sentinel transaction, acknowledging it, and marking it sent with no donor |
| Missing-donor banner/count reflects an unlinked row | **PASS** | One "No donor linked" occurrence present before linking |
| Linking a donor from the Sent tab updates the row live | **PASS** | `PATCH /api/admin/ledger/transactions/[id]` with a `donorId`, page reload showed the donor's name in place of the badge |
| Missing-donor count falls after linking | **PASS** | Count went from 1 to 0 after the link, confirmed via a second real page fetch |
| Sent Via badge (Emailed/Printed/Unknown) | **PASS** (code-level, per the companion file's grep of `SentViaBadge`'s mapping — not independently re-derived live this pass) | |

One self-caught test-script mistake, not a product defect: my first assertion also checked the
page HTML for the fixture transaction's payer name and failed — `sent-ack-list.tsx` deliberately
never renders `party` (only Date/Entity-Fund/Donor/Amount/Sent-via, per its own column set), so
that check was wrong on my part, not a gap in the component. The badge-present → link →
donor-name-appears → count-falls sequence is what actually proves the row was there and worked,
and that sequence passed.

**Not exercised this pass:** the Link Donor dialog's own search/create-donor UI specifically from
this tab — I called the underlying `PATCH` endpoint directly rather than driving the dialog's
search box. The endpoint is the same one the dialog calls and the dialog itself is unchanged,
reused code from the fund register, so risk is low, but this is not the same as having clicked
through the widget. Flagging rather than claiming coverage I don't have — same open item this
file's own handoff notes already named.

Cleanup: all sentinel fixtures deleted; a direct `SELECT` confirmed zero rows with the sentinel
name prefix remain in `ledger_donors`/`ledger_transactions`/`ledger_acknowledgments`.

### Outputs

No product code changed. This Phase 5 section (and its companions in the other two work-logs) is
the only edit from this pass.

### Verdict: PASS

### Open questions / handoff notes

- Nominate **qa** for Phase 5. **Done 2026-08-18.**
- Still worth a future session driving the Link Donor dialog's own search UI in a real browser
  from this specific tab (see above) — low risk, not yet directly exercised.
- Worth qa double-checking in the browser (not just via curl): the Link Donor
  dialog's search/create-donor flow specifically from the Sent tab (I only
  exercised the underlying PATCH endpoint directly, not the dialog's own
  fetch-and-render path — though that path is unchanged code reused verbatim
  from the fund register, so risk is low).
- This session ran concurrently with what looks like another agent's work in
  the same working tree, touching `ack-queue.tsx` (added Link Donor to the
  Pending tab too), `transactions/[id]/route.ts` (the donor-sync fix above),
  and the acknowledgment-letter-generation path (`ledger-acknowledgment-letter*`,
  dropping the "donor missing address" guard) plus a new
  `scripts/propose-donors-for-acknowledgments.ts` — evidently the companion
  script this file's "Second-order problem" section already flagged for the
  49 production rows. None of it conflicted with the files I touched, but
  whoever runs Phase 5/6 should confirm that work has its own work-log
  entry — it's a distinct, if related, change and I did not attribute any of
  it to myself here beyond the one dependency noted above.
- The 49 production rows themselves are unaffected by anything in this
  session — no production database was touched.

---

## Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-08-18

### Summary

**SHIP IT.** The core problem — a sent acknowledgment vanished from the app entirely, with no
way to link a donor to it — is genuinely fixed: `/admin/ledger/donors?tab=sent` exists, lists
every sent acknowledgment, flags missing donors with both a per-row badge and a page-level count
banner, and reuses the same `TxnDonorActions`/`LinkDonorDialog` control already proven on the
fund register rather than a second implementation. This directly unblocks the 49-row backlog
this session's other two pieces of work reference.

### What I did

- `src/app/(dashboard)/admin/ledger/donors/page.tsx:17-47, 76-140` — confirmed a genuine third
  tab (`"sent"`), gated behind the SAME page-level `auth()` + `hasFeature(session.user.id,
  FEATURES.LEDGER_RECORD)` check that already protects the whole page (lines 24-29) — no new
  route, no new permission key. `sentAcks` is only fetched when `activeTab === "sent"`
  (`Promise.resolve([])` otherwise), matching the stated intent of not adding an unconditional
  query to every page load.
- `src/components/admin/ledger/sent-ack-list.tsx` — read in full. Empty state
  (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No sent acknowledgments yet") matches
  the project convention exactly. Missing-donor badge (`bg-amber-50 text-amber-800`, "No donor
  linked") renders per-row; a page-level amber banner summarizes the count and explicitly
  explains WHY it matters ("can't produce a letter or feed a 990 Schedule B entry") rather than
  just flagging a number — this is good, informative failure-mode microcopy, not decoration.
  `SentViaBadge` correctly renders Emailed / Printed / Unknown, with the legacy-null case
  ("Unknown") carrying an explanatory `title` attribute rather than silently rendering blank.
- `src/lib/ledger-queries.ts:5076-5130` — `listAcknowledgmentsSummary()`'s `sentOnly` /
  `pendingOnly` options confirmed mutually exclusive with `pendingOnly` winning when both are
  passed, matching the stated test coverage.
- `src/lib/ledger-queries.test.ts` — confirmed the 5 named tests exist:
  `sentOnly` compiles `sent_at IS NOT NULL`, `pendingOnly` wins when both flags are passed, no
  flags issues no filter, `sentVia` passes through for `'email'`/`'print'`/legacy `null`, and PII
  fields are correctly omitted when `includePii` is false even on a donor-linked sent row.
- Re-ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (1523/1523) myself.
- Cross-checked this file's own "real bug this surfaced" section against the actual PATCH route
  (`transactions/[id]/route.ts:454-461, 619-631`) — the donor-sync fix it describes as landing
  concurrently is real and present in the current tree, and `SentAckList`'s correctness depends
  on it (the sent tab reads `ledgerAcknowledgments.donorId` via `listAcknowledgmentsSummary()`,
  which is exactly the column that fix keeps in sync). This is the same fix credited and verified
  in the companion `acknowledgment-letter-fixes` Phase 6 section above — not re-litigated twice,
  cross-referenced once.

### Intent-vs-shipped diff

- Phase 1 (bug reproduction) said: a sent acknowledgment disappears from the only screen where a
  donor would naturally be linked. Shipped: a dedicated Sent Acknowledgments tab exists and is
  reachable from the same page. **Verdict: matches.**
- Root-cause section said: an acknowledgment with no donor can't produce a letter or feed a 990
  Schedule B entry. Shipped: the banner copy states this explicitly to the treasurer, not just
  internally in a code comment. **Verdict: matches, and arguably exceeds** — the request was for
  a screen; what shipped explains the stakes in place.
- "Workaround while unfixed" section (fund register Link Donor) is now genuinely superseded, not
  just duplicated — the Sent tab is the more discoverable, purpose-built home for this action for
  a row already known to be sent and donor-less.

### Edge cases

- **Empty state:** pass, matches convention (`bg-gray-50 rounded-2xl p-10 text-center
  text-gray-500`).
- **Failure microcopy:** not directly applicable — this is a read-mostly view; the one write
  action (Link Donor) reuses `link-donor-dialog.tsx`'s existing error handling (toast-based,
  human-readable).
- **Permission gate:** pass. Page-level gate confirmed; no new route was added for this feature
  (the tab reuses the existing page and the existing `PATCH /transactions/[id]` endpoint).
- **Mobile (360px):** not exercised, same as the companion pieces — admin-only surface, not
  treated as a blocker, flagged rather than assumed.
- **Brand consistency:** pass — `rounded-2xl` cards, `rounded-lg` badges/buttons, `lions-blue`
  links and focus rings, no native dialogs anywhere in `sent-ack-list.tsx`.

### A note carried over from the companion review

The Link Donor action surfaced on this tab is the SAME `link-donor-dialog.tsx` flagged in the
`acknowledgment-letter-fixes` Phase 6 section as giving a treasurer no disambiguating signal
between similarly-named donors (e.g., a father/son pair differing only by a generational suffix).
That finding and its follow-up are tracked once, in that file, rather than duplicated here — this
view does not make that risk worse or better than it already was on the fund register; it simply
makes the same control reachable from one more place, which is the intended fix.

### Follow-ups

- Already named in this file's own handoff notes: drive the Link Donor dialog's own search/
  create-donor UI in a real browser specifically from this tab (only the underlying PATCH was
  exercised live). Low priority — the dialog is unchanged, reused code.
- See `2026-08-12-acknowledgment-letter-fixes.md` Phase 6 for the donor-search disambiguation
  follow-up, which applies here too by virtue of shared code.

### Verdict: SHIP IT
