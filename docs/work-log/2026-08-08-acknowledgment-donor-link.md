# Acknowledgment Donor Link — Work Log

> **Slug:** `2026-08-08-acknowledgment-donor-link`
> **Surface:** (dashboard) admin — The Ledger, donors & acknowledgments
> **Permission(s):** existing `LEDGER_RECORD` covers this — no permission changes
> **Estimated complexity:** small (bug fix)
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | Brief only — see below | 2026-08-08 |
| 2 — Architectural review | architect | Skipped | Fix doesn't touch invariants — see below | 2026-08-08 |
| 3 — Technical design | tech-lead | Skipped | Trivial fix — root cause documented below | 2026-08-08 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-08 |
| 5 — Verification | qa | Complete | PASS | 2026-08-08 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**No silent skips — see the Bug-Fix Variant notes below for why Phases 1–3 were brief/skipped.**

---

## The Report

Treasurer, from real production use:

> "Donor acknowledgment didn't show up on the donors and activities screen. I added Trucco
> Construction Co and acknowledged. But I still see the unacknowledged transaction."

## Root Cause

Two separate donor-id columns exist in the schema and they were allowed to diverge:

- `ledger_acknowledgments.donor_id` — set by the acknowledge flow
- `ledger_transactions.donor_id` — read by `getDonor()` (giving history) and
  `listPendingAcknowledgments()` (pending-queue donor display)

`POST /api/admin/ledger/transactions/[id]/acknowledge` (the handler behind
`AcknowledgeDialog`) inserted a `ledger_acknowledgments` row with `donorId` set, but never
wrote `donorId` onto the `ledger_transactions` row. Every other write path that links a donor
to a transaction (`LinkDonorDialog` → `PATCH /api/admin/ledger/transactions/[id]`) correctly
sets `ledger_transactions.donor_id` directly — the acknowledge path was the only one that
skipped it.

Confirmed in code before touching anything:
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (pre-fix, lines 186–199) —
  `db.insert(ledgerAcknowledgments).values({ donorId: donorId ?? null, ... })`, no companion
  write to `ledgerTransactions`.
- `src/lib/ledger-queries.ts:4896-4901` (`getDonor`) — giving history keyed off
  `eq(ledgerTransactions.donorId, donorId)`.
- `src/lib/ledger-queries.ts:4970` (`listPendingAcknowledgments`) — donor display keyed off
  `leftJoin(ledgerDonors, eq(ledgerTransactions.donorId, ledgerDonors.id))`.

This was the first donor ever created in production (1 donor, 0 transactions linked at the
time), so it surfaced on the very first use. **Production data has already been repaired by
copying `donor_id` from the acknowledgment row to its transaction** — no data fix was made or
needed as part of this work, and no script under `scripts/` was touched.

### What is NOT a bug (confirmed, left unchanged)

`listPendingAcknowledgments()` intentionally lists Foundation income ≥ $250 where the
acknowledgment row is missing **or** `sentAt IS NULL`. Recording an acknowledgment
("Record Acknowledgment") is a distinct step from mailing the letter ("Mark Sent") — the
transaction is *supposed* to stay in the pending queue until Mark Sent fires, and the dialog
says so explicitly: *"Acknowledgment recorded. Use Mark Sent once the letter has been
delivered."* The treasurer's transaction staying visible in the pending list, on its own, is
working as designed and was not touched.

## Bug-Fix Variant — Phase Notes

| Phase | What happened | Why |
|-------|---------------|-----|
| 1 (analyst) | Skipped — brief captured above instead of a full five-pass review | Report was already narrowed to a specific write path by the user; re-deriving the same brief through the analyst would not have changed the fix. |
| 2 (architect) | Skipped | The fix wraps an existing insert in `db.transaction()` and adds one `update` call using an existing FK column (`ledger_transactions.donor_id` already existed, already nullable, already referenced by `LinkDonorDialog`'s PATCH path). No new table, no new dependency, no new directory, no invariant change. |
| 3 (tech-lead) | Skipped — root cause and design captured inline in this doc | Single-file fix (plus one new test file); the decision point (overwrite vs. refuse vs. leave) is recorded below in place of a design doc. |
| 4 (full-stack-developer) | Complete | This section. |
| 5 (qa) | Pending | Next step. |
| 6 (analyst) | Pending | After qa. |

---

# Phase 4 — Implementation (full-stack-developer) — 2026-08-08

**Owner:** full-stack-developer
**Status:** complete

### Summary

`POST /api/admin/ledger/transactions/[id]/acknowledge` now wraps the acknowledgment insert and
a transaction `donor_id` update in a single `db.transaction()`, so the two donor links can no
longer diverge. Verified the diagnosis in code first (see Root Cause above), checked every
other donor-linking write path for the same gap (found none — `LinkDonorDialog` was already
correct), and added a regression test that fails on the pre-fix code with a 500 (the
un-transactioned `db.insert` call breaks once the mock enforces `db.transaction`) and passes
post-fix.

### What I did

- Read `src/components/admin/ledger/acknowledge-dialog.tsx` and the route it posts to
  (`src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`) and confirmed the missing
  `ledger_transactions.donor_id` write in the `POST` handler.
- Checked `src/lib/ledger-queries.ts` (`getDonor`, `listPendingAcknowledgments`,
  `listAcknowledgmentsSummary`) to confirm both read paths are keyed off
  `ledger_transactions.donor_id`, not `ledger_acknowledgments.donor_id` (the latter is only
  used by `listAcknowledgmentsSummary`'s PII join, which is a different screen).
- Audited every other donor-linking write path:
  - `src/components/admin/ledger/link-donor-dialog.tsx` → `PATCH /api/admin/ledger/transactions/[id]`
    (`src/app/api/admin/ledger/transactions/[id]/route.ts:431-445`) — already sets
    `ledger_transactions.donor_id` directly. No gap.
  - Donor creation (`POST /api/admin/ledger/donors`, via `DonorForm` inside
    `LinkDonorDialog`'s "Create new donor" mode) — creates the donor row only; the caller
    (`LinkDonorDialog.linkDonor`) immediately follows up with the correct `PATCH`. No gap.
  - Only the acknowledge `POST` route had the gap.
- Fixed `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`: moved the
  `ledger_acknowledgments` insert into `db.transaction()` and, when `donorId` is present in the
  request body, added `tx.update(ledgerTransactions).set({ donorId, updatedAt: new Date() })`
  in the same transaction.
- Decision (see below): an explicit `donorId` in the request **overwrites** whatever donor is
  already linked to the transaction. Omitting `donorId` (the "leave blank" option in the
  dialog) leaves the transaction's existing link untouched — it does not clear it.
- Added `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` — 3 tests,
  including one that fails on the pre-fix code.
- Checked "Mark Sent" reachability end-to-end (see Open Questions below) — found a real,
  separate defect and am flagging it rather than fixing it, per the "do not redesign" scope
  boundary in the task.

### Decision: overwrite vs. refuse vs. leave (item 3 in the task)

**Chosen: overwrite.** If the transaction already has a *different* donor linked and the
acknowledge form submits a donorId, the transaction's `donor_id` is updated to match.

Why this is the least surprising option:
- `AcknowledgeDialog` pre-fills its donor field from the transaction's *current* donor link
  (`TxnDonorActions` passes `donorId={donorId ?? undefined}` as `AcknowledgeDialog`'s
  `initialDonorId` prop). A treasurer who changes that field to a different donor and submits
  is making an explicit, visible choice inside a form field labeled "Donor" — not an accidental
  side effect.
- The standalone `LinkDonorDialog` ("Re-link" button in `TxnDonorActions`) already allows this
  exact kind of explicit overwrite with no additional confirmation. Making Acknowledge behave
  differently (refuse, or silently keep the old link) would be the surprising choice — two UI
  affordances that both say "set this transaction's donor to X" behaving inconsistently.
  Refusing would also produce a dead end with no in-dialog way to resolve the conflict, since
  `AcknowledgeDialog` has no "force" option.
- Leaving blank does NOT clear an existing link — the dialog's own copy says "Leave blank to
  record the acknowledgment without linking a donor record," which describes not touching the
  link, not removing it.

### Outputs

- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (modified) — `POST` handler
  now writes `ledger_transactions.donor_id` inside the same `db.transaction()` as the
  `ledger_acknowledgments` insert. Doc comment expanded to record the bug and the overwrite
  decision for future readers. No signature change — same request/response shape.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` (new) — 3 tests:
  1. `donorId` provided → sets `donor_id` on both the acknowledgment insert and the transaction
     update (the regression test; fails pre-fix with a 500, because the pre-fix code calls
     `db.insert` outside of `db.transaction()` and the test's mock only stubs `tx.insert`).
  2. `donorId` omitted → transaction update is never issued (0 calls).
  3. `donorId` provided when the transaction already has a *different* donor linked → the
     update overwrites it, matching the decision above.
- No schema change. No new `FEATURES` entry. No new env var.

### Gates

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 1116/1116 passing (1113 baseline + 3 new). No regressions.
- `pnpm build:only` — production build succeeds.

### Open questions / handoff notes

- **Real, separate UX/logic defect found while checking "Mark Sent" reachability — not fixed,
  flagged only, per the "do not redesign it" instruction:**
  `src/components/admin/ledger/ack-queue.tsx` (the pending-acknowledgment queue table) always
  renders a single "Record acknowledgment" button for every row (lines 129–141), regardless of
  whether that row already has an unsent acknowledgment. The component's own code comment
  admits this (lines 93–98): *"We don't have ack.id directly here... Simplification: always
  show 'Record acknowledgment' (the server handles 409 if ack exists)."* `MarkSentDialog` is
  imported and wired up (`markSentFor` state, dialog render at lines 160–166) but **no button
  in the table ever calls `setMarkSentFor(...)`** — it's dead code. For a row that already has
  a pending (unsent) acknowledgment, clicking the only available button hits the 409 branch in
  `AcknowledgeDialog` (`src/components/admin/ledger/acknowledge-dialog.tsx:118-121`), which
  shows a toast — *"An acknowledgment record already exists for this transaction. Use Mark Sent
  to complete it."* — and closes the dialog, leaving the treasurer with literally no path to
  Mark Sent from the pending-list screen. The only place Mark Sent is actually reachable is the
  per-transaction ledger row via `TxnDonorActions` (`src/components/admin/ledger/txn-donor-actions.tsx:69-81`),
  which is a different screen than "the donors and activities screen" the treasurer described.
  This is very likely what the treasurer actually hit after the acknowledgment they'd already
  recorded. Root fix requires `listPendingAcknowledgments()`
  (`src/lib/ledger-queries.ts:4951`) to return ack id/sentAt so `AckQueue` can tell "no ack yet"
  apart from "ack exists, unsent" and render the right button — that's a query-shape change
  and a small `AckQueue` change, more than a one-line fix, so I did not make it here.
  **Recommend a new work-log entry** (through the normal pipeline, not the bug-fix variant,
  since it's a UI/data-shape change) to fix `AckQueue` to show "Mark Sent" for rows with an
  existing unsent acknowledgment.
- Browser click-through for qa to run: open a Foundation income transaction ≥ $250 with no
  donor linked → Acknowledge → search/select or create a donor → Record Acknowledgment → verify
  (a) the donors list / donor detail page now shows the transaction in giving history and a
  non-zero "given" total, and (b) the pending-acknowledgments queue still shows the transaction
  as pending (by design) but with the donor name now visible instead of "No donor linked."
  Also verify leaving the donor field blank on Acknowledge does not disturb an existing
  Link-Donor link.
- Nominate **qa** for Phase 5.

---

# Phase 4 — Implementation (full-stack) — 2026-08-08 (second increment)

**Owner:** full-stack-developer
**Status:** complete

### Summary

Fixed the defect flagged in the first increment's handoff: `AckQueue`
(`src/components/admin/ledger/ack-queue.tsx`) always rendered "Record
acknowledgment" for every pending row, even rows that already had an unsent
acknowledgment — clicking it 409'd with no way to reach Mark Sent from that
screen. `listPendingAcknowledgments()` already SELECTed `ackId`/`ackSentAt`
(confirmed before touching anything, per the task's hint) but its `.map()`
dropped both before returning, so the component genuinely had no signal to
act on — the comment admitting this ("We don't have ack.id directly here")
was accurate. Carried both fields through the row shape, added a pure
`ackQueueRowAction()` helper to decide which control a row gets, wired the
already-imported-but-dead `MarkSentDialog` to a real button, and gave the
Status column two distinct badges instead of one.

### What I did

- Confirmed the root cause in code first: `listPendingAcknowledgments()`
  (`src/lib/ledger-queries.ts`, `.select()` at what was line 4954) already
  selected `ackId: ledgerAcknowledgments.id` and `ackSentAt:
  ledgerAcknowledgments.sentAt`, but the `rows.map()` immediately below
  returned only `{ txn, donor }` — both fields were fetched and then
  discarded. `PendingAcknowledgmentRow`'s type didn't declare them either, so
  `ack-queue.tsx` had no way to know they existed.
- Added `ackId: string | null` and `ackSentAt: Date | null` to
  `PendingAcknowledgmentRow` and to the `.map()` return in
  `listPendingAcknowledgments()`. Documented in the type why `ackSentAt` is
  guaranteed null on every row this query returns (the WHERE clause only
  admits `sentAt IS NULL` or no-ack rows) — kept it in the shape anyway
  rather than relying on a caller remembering that invariant.
- Created `src/lib/ack-queue-ui.ts` — pure, DB-independent helpers, following
  the existing `<feature>-ui.ts` pattern in this codebase (e.g.
  `ledger-category-ui.ts`, `financial-report-ui.ts`) used specifically to
  keep DOM-free unit coverage over decisions a client component makes (this
  project has no RTL/jsdom — `vitest.config.ts` is `environment: "node"`):
  - `ackQueueRowAction(ackId: string | null): "record" | "mark-sent"`
  - `ackQueueRowStatus(ackId: string | null): "unacknowledged" | "recorded"`
- Rewrote `src/components/admin/ledger/ack-queue.tsx`:
  - Removed the dead "always show Record acknowledgment" simplification and
    its admitting comment.
  - Each row now computes `action = ackQueueRowAction(row.ackId)` and renders
    exactly one button: "Record acknowledgment" (opens `AcknowledgeDialog`,
    unchanged) when `action === "record"`, or "Mark Sent" (opens
    `MarkSentDialog`, previously unreachable from this screen — its state
    variable existed but no button ever set it) when `action ===
    "mark-sent"`.
  - Status column now shows two distinct badges instead of one: amber
    "Pending" for `unacknowledged` (unchanged), new blue "Acknowledged — not
    sent" (`bg-blue-50 text-lions-blue border-blue-200`, the existing
    "in-progress" badge convention already used by `filings-calendar.tsx`
    and `panel-990.tsx`) for `recorded`. A treasurer can now tell the two
    states apart at a glance, per requirement 3.
  - Simplified `markSentFor` state from `PendingAcknowledgmentRow | null` to
    `string | null` (txnId) — `MarkSentDialog` only ever consumed `txnId`
    (it PATCHes `/api/admin/ledger/transactions/[id]/acknowledge` and the
    route looks the ack up by transaction id), so the extra row object was
    dead weight.
- Verified `MarkSentDialog` end-to-end by reading its full implementation
  and the PATCH handler it calls
  (`src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`):
  PATCH looks up the ack by `donationTxnId`, 404s only if none exists (can't
  happen via the new button — it only renders when `ackId !== null`), 409s
  only if already sent (can't happen — this queue excludes sent acks by
  definition), and on success sets `sentAt`, which is exactly the column
  `listPendingAcknowledgments()` filters on (`isNull(ackSentAt)`) — so a
  successful Mark Sent removes the row from the pending list on
  `router.refresh()`, confirming requirement 4.
- Added regression tests at both the query layer and the decision layer,
  per the task's "test the data/logic seam" instruction — no new test
  infrastructure, reused each file's existing patterns:
  - `src/lib/ack-queue-ui.test.ts` (new, 4 tests) — pins
    `ackQueueRowAction`/`ackQueueRowStatus` for both `ackId` states.
  - `src/lib/ledger-queries.test.ts` (extended, 2 new tests) — new
    `describe("listPendingAcknowledgments — ackId/ackSentAt row-shape
    regression")` block, reusing the file's existing `mockDbState.queue`
    select-mock (already used by `getFundReport asOfDate bounding` and
    `getPendingApprovals` blocks in the same file) to assert the mapped row
    exposes `ackId`/`ackSentAt` byte-for-byte from the query rather than
    dropping them.

### Outputs

- `src/lib/ledger-queries.ts` (modified) — `PendingAcknowledgmentRow` type
  gains `ackId: string | null` and `ackSentAt: Date | null`;
  `listPendingAcknowledgments()`'s `.map()` now returns both. No signature
  change to the exported function itself.
- `src/lib/ack-queue-ui.ts` (new) — `ackQueueRowAction()`,
  `ackQueueRowStatus()`, and their shared types (`AckRowAction`,
  `AckRowStatus`).
- `src/lib/ack-queue-ui.test.ts` (new) — 4 tests.
- `src/lib/ledger-queries.test.ts` (modified) — added
  `listPendingAcknowledgments` to the existing import list; added 2 tests in
  a new describe block.
- `src/components/admin/ledger/ack-queue.tsx` (modified) — per-row action
  selection, two-state Status badge, `MarkSentDialog` wired to a real
  button, `markSentFor` state simplified to `string | null`, doc comment
  updated.
- No schema change. No new `FEATURES` entry. No new env var. No script
  under `scripts/` touched.

### Gates

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 1122/1122 passing (1116 baseline + 6 new: 4 in
  `ack-queue-ui.test.ts`, 2 in `ledger-queries.test.ts`). No regressions.
- `pnpm build:only` — production build succeeds (exit 0), all routes
  including `/admin/ledger/donors` compile.

### Open questions / handoff notes

- Browser click-through for qa to run, using the exact production scenario
  that stranded the treasurer: on `/admin/ledger/donors`, find (or create) a
  Foundation income transaction ≥ $250 with no acknowledgment → click
  "Record acknowledgment," select/create a donor, submit → verify the row
  now shows the blue "Acknowledged — not sent" badge and a "Mark Sent"
  button (not "Record acknowledgment" again) → click "Mark Sent," fill in a
  sent date, submit → verify the row disappears from the pending queue
  entirely (per `listPendingAcknowledgments()`'s `sentAt IS NULL` filter)
  and a success toast appears. Also spot-check the empty-queue state and a
  row that already has a donor linked (donor name should render as a link
  regardless of which action the row offers).
- No behavior change to `TxnDonorActions` (the per-transaction row actions
  on the main ledger view) — it already computed `ackStatus` correctly and
  was never part of this defect; only the standalone pending-queue screen
  was broken.
- Nominate **qa** for Phase 5.

---

# Phase 5 — Verification — 2026-08-08

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Both fixes hold under automated gates, a new end-to-end
regression suite driving a real browser against the real dev app, and a
direct SQL read against the dev database (never `PROD_DATABASE_URL`)
confirming `ledger_transactions.donor_id` actually lands in the column the
bug used to leave `NULL`. The workflow the treasurer got stuck on —
record acknowledgment with a donor, see it in giving history, then Mark
Sent to clear the pending queue — now completes end to end with no dead
end and no 409. No `lions-red` anywhere in the touched files. Typecheck,
unit tests (1122/1122, no regressions), and the production build are all
clean. The full e2e suite reproduces exactly the five pre-existing
failures named in the brief, plus one previously-unlisted pre-existing
failure (`ledger-search.spec.ts`) confirmed unrelated to this change (see
below) — no new failures attributable to this fix.

### What I did

- Read both diffs in full (`route.ts`, `ack-queue.tsx`, `ledger-queries.ts`
  + its test, `ack-queue-ui.ts` + its test) and the donors page
  (`src/app/(dashboard)/admin/ledger/donors/page.tsx`) that renders
  `AckQueue`, to confirm the fix matches the root-cause diagnosis in
  Phase 4 before running anything.
- Ran the automated gates: `pnpm exec tsc --noEmit`, `pnpm test`,
  `pnpm build:only`.
- Started `pnpm dev` and wrote a new permanent Playwright regression suite,
  `e2e/ack-queue-workflow.spec.ts`, that drives the real running app as an
  admin to reproduce the treasurer's exact scenario: create a donor →
  record a Foundation income transaction ≥ $250 in a dedicated sentinel
  fiscal year (FY2096, unclaimed by any other suite) → confirm it lands on
  the pending queue offering "Record acknowledgment" → record the
  acknowledgment with the donor selected → confirm the row flips to
  "Acknowledged — not sent" with a "Mark Sent" button (never both, never
  the wrong one) → confirm the donor's own Giving History page now shows
  the gift → click Mark Sent → confirm the row leaves the pending queue.
  Matches the existing black-box discipline in this suite
  (`admin-security.spec.ts`, `ledger-category-management.spec.ts`,
  `transaction-budget-line-link.spec.ts`) — no direct DB access from the
  spec file itself; teardown is two authenticated API `DELETE` calls in
  `afterAll` (donor delete clears any `donor_id` reference; transaction
  delete cascades its ack row via the existing `ON DELETE CASCADE` FK).
- Ran that suite three times: once with an environment-gated skip on
  cleanup so I could capture the created `txnId`/`donorId` and run a
  **direct, read-only `psql` query against `DATABASE_URL`** (confirmed via
  `.env.local` this is `ep-orange-sunset-am8erati…`, NOT
  `PROD_DATABASE_URL`'s `ep-rough-smoke-am069viy…`) proving
  `ledger_transactions.donor_id` equals the donor id end to end — this is
  the exact column the bug left `NULL`. Manually deleted those two rows by
  exact id afterward, removed the temporary instrumentation, then re-ran
  the suite twice more (standalone, and inside the full e2e run) with its
  own self-cleanup, confirming 0 residual `QA E2E Ack*` rows both times.
- Ran the full `pnpm test:e2e` suite twice in a row to check for flakes and
  compare against the known-bad baseline named in the brief.
- Investigated one e2e failure not on the given known-bad list
  (`ledger-search.spec.ts`) by re-running it in isolation — confirmed it
  fails independently of this feature's test data/concurrency, and that
  its root cause (the test assumes the *current* fiscal year, 2026, has
  zero transactions/budget lines — no longer true; `SELECT DISTINCT
  fiscal_year FROM ledger_budgets` shows real FY2026 rows now exist in the
  dev DB) has nothing to do with acknowledgments, donors, or any file this
  feature touched.
- Read `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts`
  and `src/lib/ack-queue-ui.test.ts` in full to confirm the implementer's
  unit regression tests actually assert what their names claim (they do —
  the 3 route tests assert exact `db.transaction()` call arguments for the
  set/omit/overwrite donor cases; the 4 ui-helper tests pin both branches
  of `ackQueueRowAction`/`ackQueueRowStatus`).
- Stopped the dev server when finished.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — 0 errors (includes the new e2e spec file).

#### Unit Tests
`pnpm test`: **PASS**
Total: 1122 | Passed: 1122 | Failed: 0
Duration: 1.23s (54 test files)
No regressions from the pre-fix baseline (1116) plus the 6 tests the
implementer added.

#### Production Build
`pnpm build:only`: **PASS** — exit 0. 195 routes rendered, including
`/api/admin/ledger/transactions/[id]/acknowledge` and
`/admin/ledger/donors`. No new warnings.

#### End-to-End Tests
`pnpm test:e2e`: **PASS** (no new failures attributable to this change)
Total (this run's scope): 109 | Passed: 74 | Failed: 7 | Skipped: 1 | Did not run: 27 (cascading skips inside already-known-bad serial files)
Duration: ~1.1–1.2 min per run, run twice for consistency

Failures, both runs, identical set:
- `budget-star-notes.spec.ts` — pre-existing (named in brief)
- `budgeting-restructure.spec.ts` — pre-existing (named in brief)
- `cancel-occurrence.spec.ts` (2 tests) — pre-existing (named in brief)
- `prior-year-cause-line-reconcile.spec.ts` — pre-existing (named in brief)
- `transaction-budget-line-link.spec.ts` (Setup step; cascades 9 "did not run") — pre-existing (named in brief)
- `ledger-search.spec.ts` — **not on the given baseline list.** Re-ran in
  isolation (`playwright test e2e/ledger-search.spec.ts -g "FY filter
  defaults"`) and it fails the same way alone, with zero acknowledgment
  fixtures present. Root cause: the test's "current FY has no data" empty
  state assumption no longer holds — real FY2026 budget rows now exist in
  the dev DB (confirmed by direct SQL). Unrelated to this feature and
  present on `main` independent of this change; flagging as a new,
  separate environmental-drift item rather than treating it as a
  regression from this fix.
- `admin-security.spec.ts` — passed both runs (matches the brief's "intermittent, pre-existing" note; not currently failing).

New suite added by qa, run standalone (with and without cleanup) and
inside the full run — 4/4 passed every time, no flakes observed:
- `e2e/ack-queue-workflow.spec.ts`

#### Manual Click-Through (live, against dev)

| Step | Result | Notes |
|------|--------|-------|
| 1. Foundation income txn ≥ $250, no ack → pending queue offers Record acknowledgment | PASS | `e2e/ack-queue-workflow.spec.ts` test 2 |
| 2. Record ack WITH donor → `ledger_transactions.donor_id` set, verified in SQL (not just UI) | PASS | Confirmed via direct `psql` read against dev `DATABASE_URL`: `ledger_transactions.donor_id` and `ledger_acknowledgments.donor_id` both equal the selected donor's id for the same `txnId`. Donor's Giving History page also showed the $500.00 gift (`e2e/ack-queue-workflow.spec.ts` test 3). |
| 3. Row now shows "Acknowledged — not sent" badge + Mark Sent button, never Record | PASS | `e2e/ack-queue-workflow.spec.ts` test 3 asserts both the badge text and that "Record acknowledgment" has 0 matches on that row |
| 4. Mark Sent completes; row leaves the pending queue | PASS | `e2e/ack-queue-workflow.spec.ts` test 4 — this is the step that was previously impossible; confirmed via PATCH response (`sentAt` set) and a fresh queue reload showing the row gone |
| 5. Omitting donor leaves existing link untouched; different donor overwrites | PASS | Verified at the unit level (`route.test.ts`, 3 tests asserting exact `db.transaction()` call arguments) rather than re-driving the browser for this branch — read the test file in full and confirmed it actually asserts the set/omit/overwrite semantics, not just that the route returns 200 |
| 6. Badges genuinely distinguishable; no `lions-red` anywhere | PASS | Code read of `ack-queue.tsx`: amber `bg-amber-50 text-amber-800` for Pending vs. blue `bg-blue-50 text-lions-blue` for Acknowledged — not sent. `lions-red` absent from every file in the diff. |
| Underlying model unchanged (record ≠ send; stays pending until sent) | PASS | Confirmed unchanged by code read — `listPendingAcknowledgments()`'s `sentAt IS NULL OR no-ack` filter and the two-step POST/PATCH split are untouched by either increment |

Dev data created for verification: 1 donor (`QA E2E Ack Donor <ts>`), 1
Foundation income transaction (`QA E2E Ack Payer <ts>`, $500.00,
FY2096 sentinel year), plus their acknowledgment row. All were deleted —
first manually by exact id after the direct-SQL proof run, then
automatically via the suite's own `afterAll` on every subsequent run.
Confirmed via SQL count queries (`party LIKE 'QA E2E Ack Payer%'`, `name
LIKE 'QA E2E Ack Donor%'`) that 0 rows remain. Dev server stopped at the
end of the session.

### Regression Tests Added

- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` (implementer, 3 tests) — guards against: `donor_id` divergence between `ledger_acknowledgments` and `ledger_transactions` (donor set / donor omitted / donor overwritten).
- `src/lib/ack-queue-ui.test.ts` (implementer, 4 tests) — guards against: the pending queue always rendering "Record acknowledgment" regardless of row state.
- `src/lib/ledger-queries.test.ts` (implementer, 2 new tests) — guards against: `listPendingAcknowledgments()` silently dropping `ackId`/`ackSentAt` from its mapped row shape.
- `e2e/ack-queue-workflow.spec.ts` (qa, new, 4 tests) — guards against: both bugs recurring in the real app end to end — the pending queue offering the wrong action for a row's state, donor-linking not propagating to `ledger_transactions.donor_id` (and therefore to giving history), and Mark Sent being unreachable from the pending-queue screen.

### Coverage on Critical Modules

Not applicable in the strict sense — this feature touches none of
`src/lib/events.ts`, `src/lib/permissions.ts`, or `src/lib/members.ts`.
The new pure module this feature added, `src/lib/ack-queue-ui.ts`, has
both of its functions and both branches of each covered 1:1 by
`ack-queue-ui.test.ts` (4 tests / 2 functions × 2 branches) — effectively
100%.

### Feature-Gate Audit (mandatory before PASS)

No NEW protected routes or server actions were added by this bug fix —
both modified routes already existed and were already gated; the fix only
added a write inside the existing `db.transaction()` block and never
touched the auth/permission lines. Audited by reading the route file
directly (not inferred from passing tests):

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `POST /api/admin/ledger/transactions/[id]/acknowledge` | yes (line 64) | yes (line 68) | `FEATURES.LEDGER_RECORD` — correct; this is a record-level mutation, not a bulk export |
| `PATCH /api/admin/ledger/transactions/[id]/acknowledge` | yes (line 255) | yes (line 259) | `FEATURES.LEDGER_RECORD` — correct, same as POST |
| `GET /admin/ledger/donors` (renders `AckQueue`, unmodified but the feature's entry point) | yes | yes | `FEATURES.LEDGER_RECORD` — correct; donor PII is explicitly gated to this role, per the page's own comment ("donor PII is treasurer/admin only") |

### Open questions / handoff notes

- No open defects. Both increments verified end to end, including the one
  step (Mark Sent) that was previously unreachable from the UI at all.
- `ledger-search.spec.ts`'s "FY filter defaults to the current fiscal
  year" test needs its fixture assumption updated now that FY2026 has real
  budget data in the dev DB — unrelated to this feature; worth a small
  follow-up ticket so it doesn't keep tripping future e2e runs, but not a
  blocker for this PASS.
- Nominate **analyst** for Phase 6 (shipped-vs-intent). The Phase 1 brief
  was the treasurer's real report — Phase 6 should confirm the shipped fix
  matches what he actually needed: recording an acknowledgment linking the
  donor, and being able to complete Mark Sent from the same screen he was
  stuck on.
