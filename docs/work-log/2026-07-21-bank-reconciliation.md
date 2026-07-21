# Bank Statement Reconciliation — Work Log

> **Slug:** `2026-07-21-bank-reconciliation`
> **Surface:** (dashboard) admin — The Ledger
> **Permission(s):** TBD — likely existing `LEDGER_RECORD` (the per-transaction reconcile toggle already gates on it); Phase 1/3 to confirm
> **Estimated complexity:** large
> **Pipeline mode:** Full — new tables, CSV import + parsing, matching logic, new admin surface; specialist split expected; consider shipping increments

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | In progress — inc1 and inc2 designed | — | 2026-07-21 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Intent (user request, 2026-07-21)

"How should we reconcile the books? Should we have the ability to upload a Chase
bank statement and make reconciliation a somewhat automated process?" — user
confirmed "start it" on the recommended shape below.

**Recommended shape (discussed with user before kickoff):**

1. **Chase CSV activity export, not PDF statements** — Chase's activity download
   is deterministic CSV (posting date, description, amount, type, balance,
   Check or Slip #). PDF statement parsing is fragile and explicitly out of
   scope. Caveat: Chase's CSV window doesn't reach arbitrarily far back, so the
   oldest months of T-13's backlog may need manual reconciliation.
2. **Reconciliation session per account + statement period** — pick the account
   (Administrative Checking / Foundation), enter statement opening + closing
   balances, upload the CSV for the period.
3. **Auto-match** book rows to bank lines: check number first (exact), then
   amount + date-window. Matches marked cleared against the session.
4. **Zeffy batch matching** — Zeffy pays out Monday lump deposits covering the
   prior week's individual ledger rows; a bank line must be matchable to a
   *group* of Zeffy-method transactions whose sum equals the deposit exactly
   (Zeffy takes no fees). Per the treasurer-todo reference note ("payout batch"
   reconciliation).
5. **Exceptions surface** — unmatched bank lines get a one-click
   create-transaction shortcut (bank fees, interest, missed entries); unmatched
   book rows stay outstanding (feeds the existing uncashed-checks panel).
6. **Tie-out gate** — a session only closes when opening balance + cleared
   activity = closing balance.

**Folded-in prerequisite:** **T-18** — add a structured `check_number` column to
`ledger_transactions`, backfill by parsing imported memos, surface it in the
transaction form + uncashed-checks list. Matching on memo-text parsing would be
building on sand; the Chase CSV provides check numbers directly.

**Value / real backlog served:** T-13 (24 monthly statement PDFs, Jul 2025–Jun
2026, both accounts, unreconciled), T-02 (two stale outstanding OLF checks that
monthly reconciliation would keep surfacing until voided/reissued), and the
standing monthly close going forward.

**Current state (verified):** `ledger_transactions` has `reconciled` boolean +
`reconciledAt` (schema.ts ~line 652), a per-row toggle
(`src/components/admin/ledger/reconcile-toggle.tsx`, POST
`/api/admin/ledger/transactions/[id]/reconcile`, gated `LEDGER_RECORD`,
posted-only), and an uncashed-checks panel reading memo text (DECISION-031).
No statement/session concept, no balance tie-out, no import.

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete
**Verdict:** READY WITH NOTES

## Summary

The recommended shape (CSV-import, session-per-account-per-period, check-number-first
matching, Zeffy batch matching, exceptions surface, tie-out gate, T-18 folded in) is
functionally sound and directly serves the T-13 backlog and the standing monthly close.
This is entirely a treasurer/admin surface — no public or member-portal touchpoints, no
OAuth-path, access-pending, email-queue, or Google-Group-sync exposure. The scope is large
and should ship in three increments (below). Two decisions need the user's input before
Phase 3 locks the design: the tie-out gate's hard-block-vs-override policy, and whether v1
must support the full 24-month historical backlog or ship forward-only. Everything else
below has a recommended default.

## What I did

Read the work-log Intent, `docs/treasurer-todo.md` in full (T-13, T-18, T-02, T-17, T-20,
the Zeffy-payout and Activity Fund reference notes), the existing reconcile route
(`src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts`), `reconcile-toggle.tsx`,
`uncashed-checks-panel.tsx`, `docs/decisions.md` (DECISION-025, -026, -031, -032), and the
`ledgerTransactions` / `ledgerBankAccounts` schema (`src/lib/db/schema.ts` ~505-678). Ran the
five-pass review below.

### Pass 1 — User verbs

Single surface for this entire feature: **Admin** (`/(dashboard)/admin`, treasurer role,
gated `LEDGER_RECORD`). No anonymous, access-pending, or signed-in-member verbs apply —
flagging this explicitly because it's the exception to this project's usual three-surface
spread, not an oversight.

- Admin: select bank account + statement period, start (or resume) a reconciliation session
- Admin: enter statement opening balance and closing balance
- Admin: upload a Chase CSV activity export
- Admin: review auto-suggested matches (check-number-first, then amount+date-window)
- Admin: accept / reject / unmatch a suggested match
- Admin: select a Zeffy lump-deposit bank line and batch-match it against a set of
  Zeffy-method book rows
- Admin: create a new ledger transaction directly from an unmatched bank line (bank fee,
  interest, missed entry)
- Admin: view the running tie-out delta (cleared total vs. target) as matches change
- Admin: close a session when it balances
- Admin: reopen a previously closed session (mistake recovery)
- Admin: view a list of past sessions per account (audit trail)
- Admin: (existing, unchanged) toggle a single transaction's `reconciled` flag out-of-band

### Pass 2 — Flow audit

**Flow A — Start a session**
Entry: Admin → Ledger → Reconcile → "New session."
Steps: pick entity + bank account (checking/savings only — **cash-type accounts, i.e.
Petty Cash per T-20, are excluded from the account picker**; there is no bank statement to
tie out) → pick statement period → enter opening + closing balance → upload CSV.
Success: session created, CSV parsed, rows staged, redirected to the session review screen
with auto-match results shown.
Failure: CSV header doesn't match the expected Chase columns → a specific, human error
("This file doesn't look like a Chase activity export — missing a Posting Date column")
naming what's missing, not a stack trace or generic 500. Overlapping period with an
existing session on the same account → blocked or warned at creation time (previous
session's closing date should be this session's opening date − 1, standard bank-rec
discipline). Same file (or same statement period) uploaded twice → idempotent — reject the
duplicate upload with a clear message, don't double-stage bank lines.

**Flow B — Review auto-matches**
Entry: session review screen.
Steps: for each auto-suggested pair, admin accepts or rejects/unmatches. Ambiguous matches
(two book rows, same amount, same window, no check number to disambiguate) are surfaced as
candidates for the human to pick between — never silently auto-picked.
Success: accepted matches marked cleared-for-this-session.
Failure path: N/A (an unresolved ambiguous match simply falls into the exceptions list,
covered in Flow C/D).

**Flow C — Zeffy batch match**
Entry: exceptions panel, a Monday lump-deposit bank line.
Steps: admin selects "Match batch" → system suggests candidate Zeffy-method book rows in
the preceding-week window whose sum should equal the deposit (Zeffy takes no fees — the
existing treasurer-todo reference note is the spec) → admin adjusts checkboxes → confirms.
Success: all selected book rows cleared against the one bank line.
Failure: selected sum ≠ deposit amount → **block confirm**, show the delta, until it
resolves to $0.00 (matches the "Zeffy takes no fees, sum must equal exactly" invariant).
The treasurer-todo note anticipates a straddled-cutoff case (a payment recorded a day late
relative to the payout) — recommend the exceptions list, not a batch-match override, is
where that gets resolved (move the stray row into the correct week's candidate set, or
create the missing row via Flow D).

**Flow D — Create a transaction from an unmatched bank line**
Entry: exceptions panel, unmatched bank line → "Create transaction."
Steps: pre-fills date/amount/description from the bank line into the existing ledger
transaction form; admin completes fund/category/party; save.
Success: new posted transaction created, immediately matched to the originating bank line
in this session.
Failure: existing transaction-form validation applies (no new failure surface).

**Flow E — Close a session (tie-out gate)**
Entry: session review screen, "Close" button.
Steps: system computes opening balance + net cleared activity and compares to the entered
closing balance.
Success (exact match): session closes; every row cleared in this session gets
`reconciled = true` / `reconciledAt` set; session becomes a read-only audit record.
Failure (mismatch): **this is one of the two open questions below** — does the gate hard-
block close until the delta is exactly zero, or can the treasurer close anyway with a
documented discrepancy note? Either way, the delta amount and the specific outstanding
rows must be shown, not just "doesn't balance." The gate must be enforced **server-side** in
the close route (see adversarial pass), not only by disabling the button client-side.

**Flow F — Reopen a closed session**
Entry: closed session detail → "Reopen" (should route through `<ConfirmDialog>` — reopening
un-reconciles historical rows, which is a real action against the audit trail, not a toggle).
Steps: confirm dialog states plainly what will change (which rows revert to unreconciled).
Success: session status returns to open; rows cleared solely by this session's close revert
their session-clear state.
Failure/edge case: what if a row cleared by this session was *also* independently toggled
reconciled via the standalone per-row toggle in the meantime? Recommend: reopening only
reverts rows whose `reconciledAt` matches this session's close time (or an explicit
session-linkage column — Phase 3's call), so it never clobbers an unrelated later edit.

**Flow G — Existing per-row toggle**
Recommend it remains available for out-of-band corrections and pre-session historical rows,
and that session-close and the toggle write the **same** `reconciled` / `reconciledAt`
columns rather than introducing a second parallel "session-cleared" concept — see the
consistency question flagged in the Intent and repeated under Gaps below.

### Pass 3 — Permissions

No new `FEATURES` key is strictly required. Recommend:
- Upload, review, match, create-from-bank-line, close: gated `LEDGER_RECORD` — same gate the
  per-row toggle already uses, since this is the same class of action (recording reconciliation
  state on transactions) at higher throughput.
- **Reopening a closed session**: recommend gating this on `LEDGER_MANAGE` instead. Closing a
  session is meant to lock a period; reopening it is a correction to a settled audit record,
  which is closer in kind to "manage funds, budgets, entities, opening balances" than to routine
  recording. This is a recommendation for tech-lead to confirm, not a user question — flagging
  here so it isn't silently decided in Phase 4.
- Both gates must be enforced in the route handlers themselves (mirroring the existing
  `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` check in the reconcile route), not just
  hiding buttons client-side.

### Pass 4 — Edge cases the request didn't mention

- **OAuth vs. password / access-pending / Google Group sync:** not applicable. This is a
  single-surface admin feature; whoever holds `LEDGER_RECORD` reaches it regardless of sign-in
  method, and anyone without it gets the existing `/access-pending` redirect. No group-sync
  interaction.
- **Email queue:** the request doesn't mention email and I don't think it needs any — no
  "reconciliation complete" notification was asked for. Confirming this as an explicit
  non-goal now so it isn't invented in Phase 3: if the treasurer wants a completion email,
  that's a follow-up, not part of this feature's core scope.
- **Empty states:** a brand-new account with no sessions yet needs "No reconciliation sessions
  yet for this account — start one" with a CTA, not a blank table. A CSV that parses but
  contains zero bank lines in the stated period needs an explicit "0 bank lines found in this
  file" state, not a silently-empty match screen that looks like a bug.
- **Failure microcopy:** CSV parse failures and format-drift errors must name the specific
  problem ("expected a Check or Slip # column, found none") — this is a treasurer doing books
  work, not a developer; raw parser exceptions are unacceptable here.
- **Mobile (360px):** file upload + a multi-column matching grid is inherently a desktop task,
  and the treasurer is unlikely to reconcile from a phone. Recommend following the existing
  `uncashed-checks-panel.tsx` convention — `overflow-x-auto` horizontal scroll on the matching
  table — rather than forcing a card-per-row phone layout. Session summary numbers (opening/
  closing/delta) should stay legible at 360px regardless.
- **Brand consistency:** cards `rounded-2xl`, buttons `rounded-lg`, `<ConfirmDialog>` for
  reopen (and recommend also for unmatch, since unmatching a cleared row inside an *already
  closed* session — if that's even reachable — reverts audit state). Reuse the existing
  `overflow-x-auto` table pattern for the matching grid rather than inventing a new one.
- **CSV realities (named in the brief, confirmed as real gaps):**
  - Duplicate upload idempotency — needs a dedupe key (date+amount+description+check# or a
    file-content hash) so re-uploading the same file doesn't double-stage bank lines.
  - Overlapping/non-contiguous periods across sessions for the same account — validate at
    session creation.
  - CSV rows dated outside the stated period (Chase's export window doesn't always align
    exactly) — must be visibly excluded from the tie-out calculation, not silently dropped
    or silently included.
  - Pending vs. posted bank lines — Chase marks pending transactions distinctly; only settled
    lines belong in a closed statement period. Pending lines should be visibly flagged
    "pending, not yet eligible to match," not treated as ordinary unmatched lines.
  - Chase format drift — validate headers up front with a specific error (see failure
    microcopy above), not a crash mid-parse.
- **Matching ambiguity** (two book rows, same amount, same window, no disambiguating check
  number): must be presented to the human as competing candidates, never silently resolved by
  picking the first match. Already folded into Flow B above.
- **Transfer pairs** (a transfer between Administrative Checking and Foundation Checking
  appears on *both* accounts' statements, as two separate `ledger_transactions` rows sharing
  `transferGroupId` per DECISION-016/017): since matching runs per-account and each leg is
  already a discrete row, this likely "just works," but transfer legs may lack a check number
  and could collide with an unrelated same-amount book row in the same window. Flag for
  tech-lead to confirm the matching engine doesn't need special transfer-pair awareness beyond
  ordinary amount+date matching.
- **Reconciled-row immutability:** the schema comment on `ledgerTransactions` notes
  `approvedAt` guards make approved rows immutable, and DECISION-025 already established a
  precedent for a *different* kind of "reconciled row got edited anyway" conflict — the
  `syncStale` marker set when a reconciled, dues-linked row's source dues payment is edited
  or deleted after reconciliation. This feature should ask the same question for its own
  data: if a transaction is edited (or deleted) *after* being cleared by a closed session, does
  that silently break the session's tie-out retroactively, or does it get flagged? Recommend
  reusing the `syncStale`-style precedent — warn, don't silently corrupt a closed session's
  math. This is a gap the request didn't address; flagging for tech-lead, not the user, since
  the codebase already has a pattern to follow.
- **T-18 backfill accuracy:** the folded-in check-number backfill parses free-text memos
  ("Check #8249" vs. "#8249" vs. inconsistent formats). Since check-number is now the
  *primary* matching key, a bad backfill produces false auto-matches or missed ones. Recommend
  the backfill script produce a **review list of low-confidence parses** for the treasurer to
  eyeball, rather than silently accepting every regex hit as ground truth.

### Pass 5 — Adversarial pass

- **Redirect targets:** none — no `callbackUrl`/`next`/`redirect` parameters anywhere in this
  feature. Not applicable.
- **State-machine shortcuts:** the tie-out gate and the reopen action must be enforced in the
  API route body, not just by disabling buttons client-side — a treasurer (or anyone who
  briefly holds `LEDGER_RECORD`) could otherwise `POST` directly to a close or reopen endpoint
  and bypass the UI-only gate. This mirrors the existing reconcile route's server-side
  posted-only check, which is the right precedent to reuse.
- **Enumeration leaks:** not applicable — single-tenant admin surface, no account-existence
  disclosure surface.
- **Input boundaries:** CSV upload needs a max file-size limit and encoding validation (non-
  UTF8 files, empty files, header-only files). Recommend sanitizing/escaping any CSV-sourced
  text (memo/description fields) before display and before any future CSV export of this data
  — formula-injection strings (`=cmd(...)`, `+`, `-`, `@` leading characters) in bank-line
  descriptions are a real, well-known class of bug once user-supplied CSV content round-trips
  through the app and could reach a spreadsheet again.
- **Self-targeting:** not applicable — no privilege-granting action in this feature.

## Outputs

- `docs/work-log/2026-07-21-bank-reconciliation.md` — this Phase 1 section; Per-Phase Status
  row updated to `Complete / READY WITH NOTES / 2026-07-21`.
- No source files touched (Phase 1 is read-only on source per this task's instructions).

## Gaps the request didn't address (carry into Phase 2/3)

- **Tie-out override policy** — see Open Questions; the design doc can't be written without
  this answer since it determines whether "close" has one code path or two.
- **Session-clear vs. per-row `reconciled` flag consistency** — recommend they write the same
  columns (Flow G); tech-lead must confirm this is mechanically workable given how sessions
  will be modeled.
- **Reconciled-row immutability / edit-after-clear** — no answer proposed in the Intent;
  recommend reusing the DECISION-025 `syncStale` precedent.
- **Raw CSV retention** — the Intent doesn't say whether the uploaded file is stored (where,
  for how long) or parsed-and-discarded. Bank statement data is sensitive; recommend
  parse-and-discard (keep only the derived bank-line rows) unless there's a specific reason to
  retain the original file. Flagging for architect to rule on.
- **T-18 backfill review step** — recommend a low-confidence-parse review list rather than a
  silent backfill, given check-number now drives matching.
- **Reopen permission** — recommend `LEDGER_MANAGE` rather than `LEDGER_RECORD` for reopening
  a closed session; flagging for tech-lead to confirm rather than defaulting silently.

## Out of scope (confirm with user)

- PDF statement parsing — explicitly ruled out in the Intent; confirming it stays out.
- Automated Zeffy-split handling (T-17) — this feature reconciles whatever lands in each
  account today; it does not change which Zeffy form pays out to which account.
- Any completion/notification email for a closed session.
- Multi-user session locking (two treasurers editing the same session concurrently) — the
  club appears to have one active treasurer; not worth building for now, but flag as a known
  non-goal rather than an oversight.

## Increment split (proposed)

1. **inc1 — T-18 check-number column.** Schema column + idempotent migration + backfill
   script (with the low-confidence-parse review list above) + surfaced in the transaction
   form and the uncashed-checks list. Small, schema-led (database-admin, then a thin
   api/ux touch).
2. **inc2 — Sessions, CSV upload, manual matching, tie-out gate.** Reconciliation-session
   table, Chase CSV upload/parse with header validation, manual accept/reject/unmatch,
   create-transaction-from-bank-line, the tie-out gate, close, and reopen. **No auto-match,
   no Zeffy batch matching yet** — everything is matched by hand in inc2. This is the
   increment that actually unblocks T-13 and the standing monthly close, even before
   automation exists.
3. **inc3 — Auto-match + Zeffy batch matching.** Check-number-first / amount+date-window
   auto-suggestion, ambiguous-match surfacing, and the Zeffy lump-deposit batch-match flow.
   Builds on inc2's session and matching-state model.

This follows the specialist-split pattern the Ledger's prior increments used
(database-admin → api-developer → ux-developer) rather than full-stack, given the size.

## Open questions (need the user, not defaults)

1. **Tie-out gate: hard-block or override?** Does a session close *only* when opening +
   cleared activity = closing balance exactly (standard bank-rec discipline, my recommended
   default), or should the treasurer be able to close with a documented discrepancy note for
   cases like a timing difference that won't resolve this period? This changes the close
   route's shape, not just its copy — needs an answer before Phase 3.
2. **Historical backlog scope (T-13):** should inc2 support creating sessions for arbitrary
   past periods out of order (so the 24-month backlog can be worked through the feature
   itself), or is v1 forward-only from the current period, with the 24-month backlog treated
   as a separate manual/one-time exercise? This materially changes whether "previous session's
   closing date + 1" validation can be a hard rule (Pass 4, overlapping periods) or needs an
   escape hatch for out-of-order backfill.

## Open questions / handoff notes (for architect / tech-lead)

- Raw CSV file retention policy (parse-and-discard vs. store) — architect to rule.
- Session-clear vs. per-row `reconciled` mechanism consistency — tech-lead to confirm the data
  model supports writing one flag from two entry points.
- Reopen gated `LEDGER_MANAGE` vs. `LEDGER_RECORD` — tech-lead to confirm or override with
  reasoning in the design doc.
- Edit-after-clear immutability/staleness marker, modeled after DECISION-025's `syncStale`.
- Transfer-pair matching behavior — confirm no special-casing is needed beyond per-account,
  per-row amount+date matching.

---

## User decisions (2026-07-21, answered via AskUserQuestion — resolves Phase 1's two open questions)

1. **Tie-out gate: HARD BLOCK.** A session can only close when opening balance +
   cleared activity equals the statement closing balance to the penny. No
   close-with-discrepancy-note path — every difference must be resolved (create
   the missing transaction, fix an amount) before close. Enforced server-side.
2. **Historical periods: SUPPORTED.** Sessions can be created for any past
   statement period so the T-13 24-month backlog is worked through the feature
   itself (oldest-first). Months older than Chase's CSV download window still
   need manual entry or hand reconciliation — acknowledged caveat.

(Also asked and declined in the same exchange: an in-app surface for
`treasurer-todo.md`/`backlog.md` — repo files are fine.)

---

# Phase 2 — Architectural Review (architect) — 2026-07-21

**Owner:** architect
**Status:** complete
**Verdict:** Approved with suggestions

## Summary

The proposed shape holds together architecturally: single admin surface, existing
permission keys cover it, no new dependency is needed for CSV parsing, and the 3-increment
split matches the specialist-split precedent the Ledger has used successfully throughout
(DECISION-025, -031, -032). I'm ratifying the increment split with named slugs, ruling that
session-close and the legacy per-row toggle must write the same `reconciled`/`reconciledAt`
columns (no parallel "session-cleared" concept), confirming `LEDGER_RECORD` /
`LEDGER_MANAGE` as proposed, confirming hand-rolled CSV parsing living alongside
`ledger.ts`/`ledger-queries.ts`, and ruling parse-and-discard for raw CSV retention. No
`docs/decisions.md` entry from me — the exact table/column shapes are Phase 3's call
(matching the precedent set on the failed-login-visibility feature, where Phase 2 deferred
implementation-level naming/shape choices and Phase 3 logged DECISION-033). Read-only on
`docs/decisions.md` this session regardless, since another agent owns it concurrently.

## What I did

Read the Phase 1 section in full (five-pass review, User decisions block: hard-block tie-out,
historical periods supported). Read the existing reconcile surface: `ledgerTransactions` /
`ledgerBankAccounts` in `src/lib/db/schema.ts` (~505-678), the reconcile route
(`src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts`), `src/lib/csv-safe.ts`
(DECISION-023 formula-injection guard, used at CSV *export* time), `src/lib/ledger.ts` and
`src/lib/ledger-queries.ts` function inventories, `src/lib/permissions.ts` (`LEDGER_VIEW` /
`LEDGER_RECORD` / `LEDGER_MANAGE` / `LEDGER_APPROVE` — confirmed no new key needed),
`docs/treasurer-todo.md` T-20 (Petty Cash added as a `cash`-type, 1-signer account — confirms
the account picker needs an `accountType !== 'cash'` filter, not a schema change), the admin
ledger route tree (`src/app/(dashboard)/admin/ledger/{settings,donors,reimbursements,
compliance,approvals,[fundSlug],reports}`) and `admin-sidebar.tsx`'s nav-entry convention, and
`src/components/admin/ledger/` for the component-placement precedent. Also skimmed the
failed-login-visibility work-log's Phase 2 section (read-only) to confirm the "defer exact
shape to Phase 3, no DECISION entry yet" precedent I'm following here, since `docs/decisions.md`
is being edited by another agent right now.

## Findings by review area

### 1. Increment structure — ratified, with named slugs

The 3-increment split is sound and follows the established Ledger pattern (every prior
increment — dashboard, donors/acks, dues-ledger sync — shipped through Phases 4-6
separately). Ratifying as proposed:

- **inc1 — `2026-07-21-ledger-check-number`** — `check_number` column + idempotent backfill
  (with low-confidence-parse review list) + transaction-form + uncashed-checks surfacing.
  Schema-led; database-admin then a thin api/ux touch. Small enough it could plausibly go
  full-stack, but keep it schema-first since check-number correctness is load-bearing for
  inc3's auto-match — a database-admin owning the backfill script's accuracy matters more
  here than saving one handoff.
- **inc2 — `2026-07-21-ledger-reconciliation-sessions`** — sessions, CSV upload/parse, manual
  matching, hard tie-out gate, close/reopen, historical periods. This is the increment that
  unblocks T-13. Specialist split (database-admin → api-developer → ux-developer) per the
  Ledger precedent — this increment alone spans a new table set, a parser, multiple route
  handlers with a hard server-side gate, and a matching-grid UI; splitting it further would
  add overhead, but running it as one undifferentiated blob would not get the design-doc
  rigor Phase 3 needs for the tie-out gate's exact code path.
- **inc3 — `2026-07-21-ledger-auto-match`** — check-number-first / amount+date-window
  auto-suggestion, ambiguity surfacing, Zeffy batch matching. Builds on inc2's session and
  matching-state model; correctly sequenced last since it's pure enhancement on top of a
  working manual-match flow.

Each increment gets its own work-log entry per the slugs above, each running its own
Phase 4-6 (own implementer assignment, own qa PASS, own analyst SHIP IT) — this is CLAUDE.md's
existing pattern for large features, not a deviation. This Phase 2 review covers the
architectural shape of all three since they share one table/permission/route-tree design;
each increment's own Phase 2 slot in its work-log can simply cite this ruling and move
straight to "Approved — see DECISION context in 2026-07-21-bank-reconciliation.md" rather than
re-litigating placement.

### 2. New tables — placement confirmed, exact shape is Phase 3's

`src/lib/db/schema.ts` is correctly identified as the landing spot; the comment block already
at line 590-620 (`// Inc 6a adds: ...`) shows the established convention of noting which
increment added which columns/tables inline — continue it for reconciliation
(`// Bank Reconciliation inc2 adds: ...`). Session/statement-line/match-link tables belong in
the same file, near `ledgerBankAccounts`/`ledgerTransactions`, not a new schema module — this
project has one schema file by design (Schema Is the Source of Truth invariant), and nothing
about this feature warrants a second one. Idempotent migrations under
`drizzle/migrations/` following the existing numbering/naming convention. I'm not naming exact
column types, FK `ON DELETE` behavior, or unique-constraint shape here — that's Phase 3 /
database-admin territory, same deferral the architect made on failed-login-visibility's table
shape (DECISION-033 was tech-lead's, not mine). One structural constraint I am ruling on:
whichever table models "a bank line cleared against a book row" must **not** duplicate
`reconciled`/`reconciledAt` as its own parallel state — see Ruling 3 below, this is an
architectural invariant, not an implementation detail.

The `check_number` column addition to `ledger_transactions` (inc1) is an additive column on
an existing table — ordinary schema evolution, no placement question.

### 3. Session-clear vs. per-row toggle — RULING: same columns, no parallel state

Confirming Phase 1's Flow G recommendation as a hard ruling, not just a preference: session
close and the legacy per-row toggle **must** write the same `ledgerTransactions.reconciled` /
`reconciledAt` columns. Rationale:

- `reconciled`/`reconciledAt` already feed `guardrails()` (`src/lib/ledger.ts`) and
  `getOverview()`/`getDashboard()` (`src/lib/ledger-queries.ts`) — the uncashed-checks panel,
  the dashboard's aged-public-fund guardrail, and 990-prep all read these two columns as the
  single source of truth for "has this cleared the bank." Introducing a second
  "session-cleared" boolean would fork that source of truth and require every existing
  consumer to be taught about two reconciliation concepts instead of one — a materially larger
  and riskier change than what was asked for.
- The legacy per-row toggle **stays** — Phase 1 correctly identifies it's still needed for
  out-of-band corrections and for the 24-month historical backlog's edge cases (rows outside
  any session, or a treasurer fixing a mistake without reopening a whole closed session).
- What Phase 3 must design (I'm not prescribing the mechanism, just the constraint it must
  satisfy): the reopen flow (Flow F) needs to distinguish "rows this session's close set
  `reconciled=true` on" from "rows independently toggled reconciled by someone else in the
  meantime," so reopening a session reverts only the former. Phase 1 already flagged this
  (recommending a session-linkage column or timestamp match). That linkage column lives on
  `ledgerTransactions` or on the match-link table — Phase 3's call — but it must be a
  *pointer back to which session, if any, set this row's `reconciled` flag*, not a duplicate
  status value. This is the same shape of problem DECISION-025 solved with `syncStale`: don't
  fork the state, add a marker that explains provenance.

### 4. CSV parsing — no new dependency; placement confirmed

Ratifying: no new npm dependency for CSV parsing. A Chase activity export is a small,
well-structured, deterministic CSV (handful of known columns, club-scale row counts — dozens
to low hundreds of lines per statement period, not the volume that would justify a streaming
parser or an `xlsx`-class library the project has already rejected for prod use). A hand-rolled
parser in `src/lib/` is the right call against the Dependency Evaluation Criteria: this is
already solved by nothing in `package.json` for CSV *parsing* (only `exceljs` exists, for
Excel export, wrong tool and wrong direction), a hand-rolled parser has zero bundle-size cost
since it's server-only, and a 5-column CSV with header validation is not complex enough to
justify pulling in `papaparse` or similar.

Placement: `src/lib/reconciliation.ts` (parsing, matching-engine pure functions, tie-out math
— mirrors `ledger.ts`'s role as the pure-function/business-logic layer, unit-testable without
DB or Next.js, per the `ledger.test.ts` precedent) and `src/lib/reconciliation-queries.ts`
(DB-touching session/statement-line/match CRUD — mirrors `ledger-queries.ts`). This is the
correct split for this codebase: business rules (header validation, check-number-first
matching, amount+date-window scoring, Zeffy batch-sum validation, tie-out delta calculation)
belong in the pure-function file so qa can unit-test them directly, matching how `guardrails()`
and `determine990()` are tested today without spinning up a database.

**Raw CSV retention — RULING: parse-and-discard.** Store only the derived bank-line rows
(date, amount, description, check number, pending/posted flag, a dedupe key). Do not persist
the original uploaded file to Vercel Blob or anywhere else. Rationale: (a) bank statement data
is sensitive and the parsed rows already capture everything the matching engine and audit
trail need; (b) the existing `BLOB_READ_WRITE_TOKEN` / `ReceiptStorage` pluggable-adapter
pattern (DECISION-020) exists for receipts because receipts are user-facing documents a
reimbursement approver needs to *view* later — a bank CSV has no equivalent later-viewing need
once its rows are staged; (c) introducing blob storage for this doubles the surface this
increment touches (a second `ReceiptStorage`-style adapter decision) for no functional gain
Phase 1 identified. If a future need emerges (e.g., an auditor wants the original file), that's
a follow-up with its own justification, not a default.

### 5. Permissions — confirmed as proposed, no new FEATURES key

`LEDGER_RECORD` for upload/review/match/create-from-bank-line/close: confirmed. This is
recording reconciliation state on transactions at higher throughput than the existing
per-row toggle, same class of action, same gate — no reason to fragment it into a new key.
`LEDGER_MANAGE` for reopening a closed session: confirmed. A closed session is a settled audit
record; reopening it is a correction action closer in kind to "manage funds, budgets, entities,
opening balances" (the existing `LEDGER_MANAGE` description) than to routine recording. Both
gates enforced server-side in the route handlers — mirroring the existing reconcile route's
`hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` check verbatim — is a hard requirement,
not a suggestion; Phase 1's adversarial pass already flagged the state-machine-shortcut risk
correctly.

### 6. Admin surface placement — confirmed, route shape specified

Confirmed: under the existing `/(dashboard)/admin/ledger/` tree, following the established
per-subpage pattern (`settings`, `donors`, `reimbursements`, `compliance`, `approvals`,
`[fundSlug]`, `reports` today). Route shape:

- `/admin/ledger/reconciliation` — session list (per account, per Flow's audit-trail view),
  "New session" entry point.
- `/admin/ledger/reconciliation/[sessionId]` — session detail: upload (if not yet uploaded),
  match-review grid, exceptions panel, tie-out summary, close/reopen actions.

Component placement: `src/components/admin/ledger/` alongside the existing
`reconcile-toggle.tsx`, `uncashed-checks-panel.tsx`, etc. — no new top-level component
directory needed. Add a nav entry in `admin-sidebar.tsx` under the Ledger section following
the existing entries (`ledger/compliance`, `ledger/donors`) — a new admin surface with no
sidebar entry is a real defect class this project has hit before, worth naming explicitly so
Phase 4 doesn't skip it.

### 7. Invariants — confirmed, one addition

- **Idempotent migrations:** standard requirement, no feature-specific wrinkle.
- **Server-side tie-out/reopen enforcement:** ruled on above (Section 5) — hard requirement.
- **Posted-only rows reconcilable:** existing rule in the reconcile route
  (`txn.status !== "posted"` → 400) must carry into the session-based matching path too — a
  pending or rejected transaction should never be offered as a match candidate. Flagging
  explicitly since inc2's matching query is new code, not a copy of the existing route.
- **DECISION-025 `syncStale` precedent for edit-after-clear:** confirmed as the right pattern
  to reuse (Section 3 above) — this is architecturally consistent with how the codebase already
  handles "a reconciled row's underlying data changed after the fact." Exact mechanism (new
  boolean vs. reusing `syncStale` vs. a session-scoped marker) is Phase 3's call.
- **Petty Cash excluded from account picker:** confirmed as a query-level filter
  (`accountType !== 'cash'`), not a schema change — `ledgerBankAccounts.accountType` already
  supports arbitrary text values today (T-20 added `'cash'` as a value without a schema change,
  per `docs/treasurer-todo.md`), so this is a `WHERE` clause in whichever query populates the
  account picker, not new column work.
- **CSV input boundaries:** confirmed — file-size cap, encoding validation (reject non-UTF-8 /
  empty / header-only files with the specific microcopy Phase 1 specified), and reuse of the
  `csvCellSafe()` formula-injection guard (`src/lib/csv-safe.ts`, DECISION-023) is the right
  precedent, but note its *direction*: `csv-safe.ts` today guards CSV **export** (escaping
  before writing a cell into a CSV this app generates). This feature's exposure is CSV
  **import** — a memo/description field parsed *from* a bank CSV, later displayed on-screen
  (React auto-escapes, no formula-injection risk there) and potentially later flowing into the
  *existing* ledger CSV export (`src/lib/csv-ledger-export.ts`) if that field ends up in an
  exported column. Ruling: no new escaping logic needed at *import* time — sanitize/validate
  for encoding and size, not formula characters, on the way in; rely on the existing
  `csvCellSafe()` call sites in the export path (which already escape whatever is in the
  `memo`/`description`/`party` columns regardless of source) to neutralize the formula-injection
  risk at the one point it can actually reach a spreadsheet again. Phase 3 should confirm the
  export path's existing `csvCellSafe()` calls do in fact cover any new column this feature
  populates (e.g., if bank-line descriptions land in an existing free-text column, it's already
  covered; if in a new column that later gets added to the export, it must route through
  `csvCellSafe()` too).

## Outputs

- `docs/work-log/2026-07-21-bank-reconciliation.md` — this Phase 2 section; Per-Phase Status
  row updated to `Complete / Approved with suggestions / 2026-07-21`.
- No `docs/decisions.md` entry written — deferred to Phase 3, matching the precedent set on
  the failed-login-visibility feature (Phase 2 rules on placement/fit, Phase 3 commits to and
  logs the exact table/column shape as DECISION-NNN). Also read-only on `docs/decisions.md`
  this session since another agent is editing it concurrently for a different feature.
- No source files touched (Phase 2 is read-only on source; `schema.ts`, `drizzle/migrations/`,
  and `permissions.ts` are additionally being edited by another agent right now for the
  failed-login feature — not touched here regardless).

## Open questions / handoff notes (for tech-lead)

- Exact session/statement-line/match-link table shapes, column types, FK behavior, and unique
  constraints (e.g., a dedupe key for duplicate-upload rejection, per Phase 1's Flow A) — all
  Phase 3/database-admin's call within the constraints ruled above.
- The session-linkage mechanism for Flow F's selective-reopen (Section 3) — must exist in some
  form; exact shape is Phase 3's.
- Confirm whether any bank-line-sourced free-text column is new or reuses an existing
  `memo`/`description`-style column already covered by `csvCellSafe()` at export time (Section
  7's CSV-safety note).
- T-18 backfill low-confidence-review-list mechanism (surfaced to the treasurer how? — a CLI
  script output, an admin page, an email?) — Phase 1 recommended the concept but didn't specify
  delivery; Phase 3 should pick one of the existing patterns rather than invent a new one.
- Log the exact schema/table-shape decision as a new numbered `docs/decisions.md` entry once
  the other agent's concurrent edit is done (or in Phase 3 directly, per the failed-login
  precedent).

---

# Phase 3 — Technical Design (tech-lead)

Per the architect's Phase 2 ruling, this feature's technical design is split
across three increment work-logs (one per increment, each running its own
Phase 3-6). This section is a pointer, not a duplicate — read the linked
files for the actual designs.

- **inc1 — `docs/work-log/2026-07-21-ledger-check-number.md`** — T-18
  structured check numbers. Design complete 2026-07-21. Notably: the
  parent Intent's premise that check numbers "live in free-text memos" and
  that a memo-parsing backfill was needed turned out, on inspection of the
  real data, to be false — see that file's Phase 3 Summary and
  `docs/decisions.md` DECISION-034 for the corrected backfill mechanism
  (CSV-register replay against the still-accessible source files, matched
  non-destructively into the existing rows) and a data-quality bug it
  surfaced along the way (3 rows mistagged `paymentMethod='check'` that are
  actually debit-card purchases).
- **inc2 — `docs/work-log/2026-07-21-ledger-reconciliation-sessions.md`** —
  sessions, CSV upload/parse, manual matching, hard tie-out gate,
  close/reopen. Design complete 2026-07-21. Notably: three new tables
  (`ledger_reconciliation_sessions`, `ledger_bank_lines`,
  `ledger_reconciliation_matches`) plus a `reconciledSessionId` provenance
  pointer on `ledgerTransactions` (session close still writes the same
  `reconciled`/`reconciledAt` columns the legacy toggle writes, per this
  work-log's Phase 2 §3 ruling — the pointer only tracks *which* session set
  them, so reopen can selectively revert). The match-link table is shaped
  many-to-one (unique on `transactionId`, not on `bankLineId`) so inc3's
  Zeffy batch matching needs no schema change. Resolves inc1's two forwarded
  Phase 6 notes: NULL `check_number` is treated as an ordinary, non-error
  case throughout the matching path, and Chase's "Check or Slip #" value is
  stored raw on every bank line but only pre-fills a new transaction's
  `checkNumber` when the line is a debit (never a credit/deposit), so the
  same category confusion T-21 found on `payment_method` doesn't re-enter
  through `check_number`. See that file's Phase 3 section and
  `docs/decisions.md` DECISION-036 for the full design, including the
  reopen-ordering rule (can't reopen a session if a later-period session on
  the same account is already closed) and the hard, hard-tie-out-consistent
  reconciled-row immutability lock (full lock, not a `syncStale`-style
  silent-degradation marker).
- **inc3 — `docs/work-log/2026-07-21-ledger-auto-match.md`** — check-number-
  first / amount+date-window auto-match, Zeffy batch matching. Not yet
  designed; depends on inc1 and inc2.

---

# Phase 4 — Implementation

_(pending)_

---

# Phase 5 — Verification (qa)

_(pending)_

---

# Phase 6 — Shipped vs Intent (analyst)

_(pending)_
