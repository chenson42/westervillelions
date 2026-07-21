# Ledger — Bank Reconciliation Sessions (inc2) — Work Log

> **Slug:** `2026-07-21-ledger-reconciliation-sessions`
> **Parent feature:** `2026-07-21-bank-reconciliation` (this is **inc2 of 3** — see
> `docs/work-log/2026-07-21-bank-reconciliation.md` for the full Intent, the
> analyst's five-pass review, both User-decisions blocks [hard-block tie-out;
> historical periods supported], and the architect's cross-increment rulings).
> See also `docs/work-log/2026-07-21-ledger-check-number.md` (inc1, closed
> SHIP IT) — its Phase 6 forwarded two notes this design incorporates (NULL
> `check_number` is a live case; a `paymentMethod='check'` row can be a
> deposit, not a paper check).
> **Surface:** (dashboard) admin — The Ledger (new reconciliation surface)
> **Permission(s):** No new key — existing `LEDGER_RECORD` (create session,
> upload, match, unmatch, create-from-bank-line, close) and `LEDGER_MANAGE`
> (reopen); reads gated `LEDGER_VIEW`
> **Estimated complexity:** large
> **Pipeline mode:** Full, Phases 1-2 complete-by-reference (see below)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | **Complete by reference** — see parent work-log Phase 1 (five-pass review, Flows A-G, both User-decisions blocks) | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | **Complete by reference** — see parent work-log Phase 2, esp. "Increment structure" (inc2 named + scoped), Section 3 (same-columns ruling + provenance-pointer requirement), Section 4 (hand-rolled parser placement, parse-and-discard), Section 6 (route/component placement), Section 7 (CSV-safety direction) | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-21 |
| 4 — Implementation | database-admin → api-developer → ux-developer | **Complete** — Increment A (database-admin: schema + migration + parser lib) complete; Increment B (api-developer: 8 routes + 2 edits) complete; Increment C (ux-developer: pages + 8 components + nav) complete | — | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-21 |

---

# Phase 3 — Technical Design (tech-lead) — 2026-07-21

**Owner:** tech-lead
**Status:** complete

## Summary

This increment adds reconciliation **sessions** (one per bank account +
statement period), a hand-rolled Chase CSV activity-export parser, manual
accept/unmatch matching between staged bank lines and existing ledger
transactions, a one-click create-transaction-from-bank-line shortcut for fees
and interest, a **hard** tie-out gate enforced server-side (per the user's
2026-07-21 decision — no discrepancy-note escape hatch), and reopen. No
auto-match and no Zeffy batch matching ship in this increment (inc3) — but the
match-link table is shaped many-to-one from the start (unique on
`transactionId`, not on `bankLineId`) so inc3 can add batch matching without a
schema change. Three new tables (`ledger_reconciliation_sessions`,
`ledger_bank_lines`, `ledger_reconciliation_matches`) plus one new provenance
column on `ledger_transactions` (`reconciledSessionId`). Session close writes
the same `reconciled`/`reconciledAt` columns the legacy per-row toggle already
writes (architect's Ruling 3) — the new column only tracks *which session, if
any,* set them, so reopen can revert precisely the rows this session touched
without clobbering an independent later edit. Logged as **DECISION-036**.

## What I did

Read the parent work-log in full (Phases 1-2, both User-decisions blocks) and
inc1's closed work-log in full, including its Phase 6 handoff notes (NULL
`check_number` is live — 4 Gates At Eight rows remain unassigned; a
`paymentMethod='check'` row can be a deposit with a "Check or Slip #" value of
`"DEP"`, per the Don Niebling row). Read `src/lib/db/schema.ts` L490-850
(`ledgerEntities`, `ledgerBankAccounts`, `ledgerFunds`, `ledgerTransactions`
incl. inc1/DECISION-035's comment trail, `ledgerAcknowledgments`,
`ledgerBudgets`, `ledgerSettings`). Read the existing per-row reconcile route
(`src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts`) and the
transaction PATCH/DELETE route's `approvedAt`-based immutability guard
(`src/app/api/admin/ledger/transactions/[id]/route.ts`) to confirm the
existing lock pattern I'm reusing. Read `src/lib/csv-safe.ts` (DECISION-023,
export-direction formula-injection guard) and confirmed its non-applicability
at *import* time per the architect's Section 7 ruling. Read
`src/lib/ledger-queries.ts` L175-205 (`getFunds`/`getBankAccounts`) for the
account-picker query convention and L939-1060 (`uncashedRows`/
`UncashedCheckRow`) for the row-shape/query-shape precedent. Read
`docs/decisions.md` DECISION-025 (dues↔ledger `sync_stale` /
`dues_payment_id` shape — the "add a marker, don't fork state" precedent this
design's `reconciledSessionId` column follows) and DECISION-034/-035 in full
(the two most recent entries, confirming DECISION-035 is latest at the time I
started). Ran `ls drizzle/migrations/` — confirmed `0057_ledger_receipt_waiver.sql`
is the latest committed file (claimed by the concurrent transaction-receipts
work happening right now); confirmed `gen_random_uuid()` + `timestamptz` is
this codebase's migration convention (`0044_ledger_books.sql`) and mirrored it.
Read `src/app/api/members/reimbursements/upload/route.ts` for this codebase's
`request.formData()` multipart-upload convention, which the CSV-upload route
mirrors. Grepped `FEATURES.LEDGER_VIEW` usage across
`src/app/api/admin/ledger/` to confirm read routes gate on `LEDGER_VIEW`, not
`LEDGER_RECORD`. **I did not edit `src/lib/db/schema.ts`, any file under
`drizzle/migrations/`, or `src/lib/ledger-queries.ts`** — a database-admin is
actively editing those files right now for the transaction-receipts feature
(receipt-waiver columns, `receipt_url` → `receipt_storage_key` rename,
migration `0057`); this design's migration numbering is explicitly **next-free
at implementation time**, not `0057`. I did not run `pnpm dev`, any test
command, or any build — design-only, per this task's boundary.

## Permissions

No new `FEATURES` key. Reuses the three existing `LEDGER_*` keys exactly as
the architect confirmed in Phase 2 Section 5:

| Action | Gate |
|--------|------|
| Create session | `LEDGER_RECORD` |
| Upload/parse CSV | `LEDGER_RECORD` |
| Match / unmatch | `LEDGER_RECORD` |
| Create transaction from bank line | `LEDGER_RECORD` |
| Close session | `LEDGER_RECORD` |
| **Reopen session** | `LEDGER_MANAGE` |
| List / view sessions | `LEDGER_VIEW` |

Every gate is enforced in the route handler body via
`hasFeature(session.user.id, FEATURES.LEDGER_RECORD | FEATURES.LEDGER_MANAGE | FEATURES.LEDGER_VIEW)`
— mirroring the existing reconcile route's `hasFeature(...)` call verbatim,
never a client-side-only check. This directly satisfies Phase 1's adversarial
pass ("a treasurer could `POST` directly to a close or reopen endpoint and
bypass a UI-only gate").

## API Contract

All routes under `src/app/api/admin/ledger/reconciliation/sessions/`. All
require `auth()` (401 if absent) before the feature-gate check (403).

### `GET /api/admin/ledger/reconciliation/sessions`

Gate: `LEDGER_VIEW`. Query params: `entityId` (optional), `bankAccountId`
(optional), `status` (optional, `open` | `closed`). Returns sessions ordered
`statementPeriodEnd DESC`, each with `{ id, bankAccountId, bankAccountName,
entitySlug, statementPeriodStart, statementPeriodEnd, openingBalanceCents,
closingBalanceCents, status, uploadedAt, csvRowCount, closedAt }`. Powers the
list/audit-trail page (Phase 1's "view a list of past sessions per account").

### `POST /api/admin/ledger/reconciliation/sessions`

Gate: `LEDGER_RECORD`. Body:
```
{ bankAccountId: string; statementPeriodStart: string; // YYYY-MM-DD
  statementPeriodEnd: string; openingBalanceCents: number; closingBalanceCents: number }
```
Validation, in order:
1. `bankAccountId` exists and belongs to an active account → 404 if not.
2. `bankAccount.accountType !== 'cash'` → **400** `"Cannot create a
   reconciliation session for a cash account"` — server-side re-enforcement of
   the account-picker filter (Phase 1 adversarial pass: query-level filter is
   not enough on its own).
3. `statementPeriodStart <= statementPeriodEnd` → 400 otherwise.
4. `openingBalanceCents` / `closingBalanceCents` are integers → 400 otherwise.
5. **Overlap check (hard block):** fetch every existing session (any status)
   for this `bankAccountId`; if `[statementPeriodStart, statementPeriodEnd]`
   overlaps any existing session's period (inclusive boundaries — sharing even
   one calendar day counts as overlap, since one bank-statement day can't
   belong to two sessions on the same account) → **409** `{ error: "This
   period overlaps an existing session (Jul 1–Jul 31, 2025)", conflictingSessionId }`.
   Pure logic in `validatePeriodOverlap()` (`src/lib/reconciliation.ts`).
6. **Contiguity (soft, non-blocking):** if the most recent existing session for
   this account (by `statementPeriodEnd`) doesn't end exactly one day before
   this session's `statementPeriodStart`, the **201** response still succeeds
   but includes `{ gapWarning: "Prior session for this account closed
   2025-06-30; this period starts 2025-08-01, leaving a 31-day gap. Continue
   if that's expected." }`. Pure logic in `computePeriodGapWarning()`. This is
   the deliberate split the User Decision on historical backlog requires:
   **overlap corrupts tie-out math and is always blocked; a gap is often
   legitimate** (a month with no statement, or working the 24-month backlog
   out of strict order) and must never block session creation.
7. Insert row, `status: 'open'`. **201** `{ id, ...session, gapWarning? }`.

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/upload`

Gate: `LEDGER_RECORD`. `multipart/form-data`, field `file` — mirrors
`src/app/api/members/reimbursements/upload/route.ts`'s `request.formData()`
convention.

Validation, in order:
1. Session exists, `status === 'open'` → 404 / 409 otherwise.
2. `session.uploadedAt === null` → **409** `"This session already has an
   uploaded statement"` otherwise (one CSV upload per session in inc2; no
   replace/re-upload path — matches Flow A's "same file uploaded twice"
   idempotency requirement at the simplest possible layer: a session-level
   one-shot gate, not row-level dedup as the primary defense).
3. File size ≤ 2 MB → **413** `"File is too large (max 2MB)"` otherwise —
   generous headroom over a realistic club-scale Chase export (dozens to low
   hundreds of rows).
4. File decodes as valid UTF-8, non-empty → **400** `"File is empty or not a
   valid text file"` otherwise.
5. Header row validated against the expected Chase columns (`Posting Date`,
   `Description`, `Amount`, `Type`, `Balance`, `Check or Slip #` — order-
   independent, case/whitespace-tolerant lookup by name) via
   `validateChaseCsvHeader()`. On failure: **400** naming the *specific*
   missing column, e.g. `"This file doesn't look like a Chase activity export
   — missing a Posting Date column"` — verbatim per Phase 1's Flow A example.
6. Parse every row via `parseChaseCsvRow()`; a row-level parse failure (e.g. an
   unparseable `Amount` field) is **400** naming the row number and the bad
   value, not a generic 500 or a silently-skipped row.
7. For each parsed line: compute `inStatementPeriod` (posting date within
   `[session.statementPeriodStart, session.statementPeriodEnd]`) and
   `dedupeKey` (`bankLineDedupeKey()` — deterministic from posting date +
   description + signed amount + check/slip number).
8. Bulk insert into `ledger_bank_lines` with
   `ON CONFLICT (session_id, dedupe_key) DO NOTHING` (defense-in-depth against
   a literally-duplicated row inside one file — not the primary duplicate-
   upload defense, which is step 2's session-level gate).
9. Update session: `uploadedAt = now()`, `csvFilename`, `csvRowCount`.
10. **The raw file is never persisted** — parsed in memory, discarded after
    step 8/9 write the derived rows, per the architect's parse-and-discard
    ruling. No Vercel Blob call, no `ReceiptStorage` adapter involvement.
11. **201** `{ sessionId, rowCount, outOfPeriodCount, gapWarning?: null }`.

### `GET /api/admin/ledger/reconciliation/sessions/[sessionId]`

Gate: `LEDGER_VIEW`. Returns session metadata, all bank lines (each with
`matchedTransactionId: string | null`, derived from a `LEFT JOIN` against
`ledger_reconciliation_matches` — no denormalized status column, per the
"don't fork state" principle), candidate transactions for matching (posted,
`reconciled = false`, `bankAccountId` = this session's account, not already
matched in *any* session — derived via `NOT EXISTS` against
`ledger_reconciliation_matches`), and a computed tie-out summary
(`{ openingBalanceCents, matchedTotalCents, closingBalanceCents, deltaCents,
balanced, unmatchedInPeriodCount }` via `computeTieOut()`).

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match`

Gate: `LEDGER_RECORD`. Body: `{ bankLineId: string; transactionId: string }`.
Validation:
1. Session `status === 'open'` → 409 otherwise (`"Reopen this session before
   changing matches"` if closed).
2. `bankLineId` belongs to this session → 404 otherwise.
3. **This bank line has no existing match row** → **409** `"This bank line is
   already matched — unmatch it first"`. This is a *route-level* rule, not a
   DB unique constraint — inc3 removes this check (not the schema) to enable
   many-to-one Zeffy batch matching.
4. `transactionId` is `posted`, `bankAccountId` matches this session's
   account, `reconciled = false`, and has no existing match row (DB-enforced —
   `transactionId` **is** unique on the match table, forever; a book row
   clears against exactly one bank line, full stop, even after inc3) → 400/409
   naming which condition failed.
5. Insert match row. No amount/date agreement check in inc2 — the human's
   judgment is the entire matching engine this increment; inc3 adds
   check-number-first/amount+date-window *scoring*, but never *requires*
   agreement to persist a match, then or now.
6. **201** `{ matchId, bankLineId, transactionId }`. Does **not** touch
   `reconciled`/`reconciledAt` — those flip only at session close (batch), per
   the architect's Ruling 3.

**"Accept/reject" naming, resolved:** inc2 has no auto-match engine, so there
is nothing to "accept" a *suggestion* from — the human always explicitly picks
both sides of a pair. `match` (above) **is** the accept action. There is no
persisted "rejected match" state: the task's "reject" verb maps to the human
simply not selecting a given candidate from the picker UI — a client-side,
non-persisted action. Building a `rejected` status with no consumer (no
auto-match engine yet to feed a rejection list back into) would be state with
no read path; adding it in inc3 alongside the scoring engine, if the ambiguous-
candidate UI needs it then, is the right sequencing.

### `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]`

Gate: `LEDGER_RECORD`. ("Unmatch.") Validation: session `status === 'open'`
(409 otherwise — unmatch on a closed session requires reopening first, since
the transaction's `reconciled` flag has already been finalized by close and
unmatching alone wouldn't revert it); match row belongs to this session (404
otherwise). Deletes the match row. **200** `{ deleted: true }`.

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/create-from-bank-line`

Gate: `LEDGER_RECORD`. Body mirrors the existing transaction-form fields, pre-
filled client-side from the bank line (date, signed amount → `flow` +
`amountCents`, description → `memo`) but always admin-completed/confirmed:
```
{ bankLineId: string; fundId: string; categoryId?: string; party?: string;
  memo?: string; flow: 'income' | 'expense'; paymentMethod?: string;
  checkNumber?: string | null }
```
Validation: identical to the existing `POST
/api/admin/ledger/transactions` body validation (reused, not reinvented —
implementer should factor the shared checks into a helper both routes call,
or call the existing route's internal validator if it's already
extractable). Additional steps, in one DB transaction (mirrors DECISION-025's
dues-ledger atomic pattern):
1. Bank line belongs to this open session, has no existing match.
2. Insert the new `ledger_transactions` row (`status: 'posted'`,
   `recordedByUserId: session.user.id`, `bankAccountId` = this session's
   account).
3. Insert a match row linking the new transaction to the bank line.
4. **201** `{ transactionId, matchId }`.

**Deposit-slip pre-fill rule (resolves inc1's Phase 6 forward note):** the
client pre-fills `checkNumber` from the bank line's `checkOrSlipNumber`
**only when the bank line's `amountCents` is negative** (a debit/paper
check). For a credit/deposit line, `checkOrSlipNumber` is never copied into
the new transaction's `checkNumber` — Chase's own column conflates "check
number" and "deposit slip number" (the exact ambiguity T-21/DECISION-034
uncovered on the `payment_method` side), and this design refuses to re-import
that confusion into the new `checkNumber` matching key inc3's auto-match will
rely on. The admin can still manually type a value if they have a specific
reason to; this is a pre-fill default, not a server-enforced rule (no security
boundary here — an admin who deliberately overrides a pre-fill isn't a threat
model this route needs to defend against).

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close`

Gate: `LEDGER_RECORD`. No body. **Hard tie-out — per the user's 2026-07-21
decision, no override path exists.** Validation, in one DB transaction:
1. Session `status === 'open'` → 409 otherwise.
2. **Every in-period bank line has a match.** (Explicitly checked as its own
   condition — not merely implied by the sum tying out. Rationale: if only a
   subset of in-period lines were matched and their amounts happened to sum to
   exactly the target delta, the sum-only check would pass while legitimate
   bank lines sit unmatched. This gate closes that loophole.) Failure: **400**
   `{ error: "N bank lines are still unmatched", unmatchedBankLineIds: [...] }`.
3. Every matched transaction is still `status === 'posted'` (defensive re-
   check — a matched transaction shouldn't be reachable in any other status,
   but a row could theoretically be rejected via a different route between
   match-time and close-time). Failure: **400** naming which transaction.
4. **Tie-out arithmetic** via `computeTieOut()`:
   `openingBalanceCents + sum(matched, in-period bank lines' signed
   amountCents) === closingBalanceCents`. Any non-zero delta → **400**
   `{ error: "Does not balance", deltaCents, closingBalanceCents,
   computedCents }` — the UI shows this delta and the specific outstanding
   rows per Flow E, never a generic "doesn't balance."
5. On success: `UPDATE ledger_transactions SET reconciled = true, reconciledAt
   = now(), reconciledSessionId = $sessionId WHERE id IN (matched transaction
   ids)`; `UPDATE ledger_reconciliation_sessions SET status = 'closed',
   closedAt = now(), closedByUserId = $userId`. **200**
   `{ sessionId, status: 'closed', clearedCount }`.

Out-of-period and pending bank lines are excluded from both the "must be
matched" gate and the tie-out sum — they're visibly flagged, never silently
dropped (Phase 1 Pass 4), but are out of scope for *this* session's close by
definition.

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/reopen`

Gate: **`LEDGER_MANAGE`**. No body (client wraps the trigger button in
`<ConfirmDialog>` per Flow F — the API itself doesn't need a confirmation
field; the confirm step is a UI discipline, not a payload requirement).
Validation, in one DB transaction:
1. Session `status === 'closed'` → 409 otherwise.
2. **Ordering rule (named, per the task's explicit ask):** query for any
   *other* session on the same `bankAccountId` with `status = 'closed' AND
   statementPeriodEnd > this.statementPeriodEnd`. If found → **409**
   `{ error: "Cannot reopen — the session for Aug 1–Aug 31, 2025 is already
   closed. Reopen that session first.", blockingSessionId }`. This prevents an
   inconsistent audit trail where an earlier period gets reopened while a
   later period has already built its own closed state on top of it.
3. On success: `UPDATE ledger_transactions SET reconciled = false,
   reconciledAt = null, reconciledSessionId = null WHERE reconciledSessionId =
   $sessionId` — reverts **only** rows this session's close touched (the
   provenance pointer, not a timestamp-match heuristic). `UPDATE
   ledger_reconciliation_sessions SET status = 'open', reopenedAt = now(),
   reopenedByUserId = $userId, closedAt = null, closedByUserId = null`.
   Existing match links are **not** deleted — the treasurer sees exactly what
   was matched before and can fix-and-reclose without re-picking everything.
   **200** `{ sessionId, status: 'open', revertedTxnCount }`.

## Data Model

Three new tables, one new column on `ledger_transactions`. All in
`src/lib/db/schema.ts`, immediately after `ledgerBudgets`/`ledgerSettings`
(same file — no second schema module, per the architect's Section 2 ruling).

```typescript
// ─────────────────────────────────────────────────────────────────────────
// The Ledger — Bank Reconciliation inc2: sessions, bank lines, match links
// Session close writes the SAME ledgerTransactions.reconciled/reconciledAt
// columns the legacy per-row toggle writes (architect Ruling 3, parent
// work-log Phase 2 §3) — reconciledSessionId (added to ledgerTransactions,
// below) is a provenance pointer, not a parallel status. DECISION-036.
// ─────────────────────────────────────────────────────────────────────────

export const ledgerReconciliationSessions = pgTable(
  "ledger_reconciliation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => ledgerBankAccounts.id, { onDelete: "cascade" }),
    statementPeriodStart: date("statement_period_start").notNull(),
    statementPeriodEnd: date("statement_period_end").notNull(),
    openingBalanceCents: integer("opening_balance_cents").notNull(),
    closingBalanceCents: integer("closing_balance_cents").notNull(),
    status: text("status").notNull().default("open"), // 'open' | 'closed'
    uploadedAt: timestamp("uploaded_at"),
    csvFilename: text("csv_filename"),   // display-only; the file itself is never stored
    csvRowCount: integer("csv_row_count"),
    closedAt: timestamp("closed_at"),
    closedByUserId: uuid("closed_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    // Last-reopen-only (current state, not an append-only log — mirrors the
    // receipt-waiver trio's precedent, DECISION-035). Cleared on re-close.
    reopenedAt: timestamp("reopened_at"),
    reopenedByUserId: uuid("reopened_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Defense-in-depth: exact-duplicate period for the same account rejected
    // at the DB layer too, not just by the route's overlap check.
    unique("ledger_recon_sessions_account_period_key").on(
      t.bankAccountId, t.statementPeriodStart, t.statementPeriodEnd,
    ),
    index("ix_ledger_recon_sessions_account").on(t.bankAccountId, t.statementPeriodEnd),
  ],
);
export type LedgerReconciliationSession = typeof ledgerReconciliationSessions.$inferSelect;
export type NewLedgerReconciliationSession = typeof ledgerReconciliationSessions.$inferInsert;

export const ledgerBankLines = pgTable(
  "ledger_bank_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ledgerReconciliationSessions.id, { onDelete: "cascade" }),
    // Denormalized from the session for query convenience (e.g. a future
    // cross-session audit query) — not used for cross-session dedupe, which
    // is unnecessary given overlap is blocked at session creation.
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => ledgerBankAccounts.id, { onDelete: "cascade" }),
    postingDate: date("posting_date").notNull(),
    description: text("description").notNull(), // raw Chase text; no import-time escaping (see Edge Cases)
    amountCents: integer("amount_cents").notNull(), // SIGNED — positive=credit, negative=debit (Chase's own convention; deliberate divergence from ledgerTransactions' positive-only + flow model, see Edge Cases)
    rawType: text("raw_type"), // Chase "Type" column, kept as-is (e.g. "ACH_DEBIT")
    // Chase's own "Check or Slip #" column, verbatim. Meaning depends on sign
    // (see the deposit-slip ruling above) — never split into two columns.
    checkOrSlipNumber: text("check_or_slip_number"),
    balanceCents: integer("balance_cents"), // Chase's running balance; display-only, not used in tie-out math
    inStatementPeriod: boolean("in_statement_period").notNull().default(true),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_bank_lines_session_dedupe_key").on(t.sessionId, t.dedupeKey),
    index("ix_ledger_bank_lines_session_period").on(t.sessionId, t.inStatementPeriod),
    index("ix_ledger_bank_lines_check_slip").on(t.bankAccountId, t.checkOrSlipNumber), // shape inc3's auto-match will need
  ],
);
export type LedgerBankLine = typeof ledgerBankLines.$inferSelect;
export type NewLedgerBankLine = typeof ledgerBankLines.$inferInsert;

export const ledgerReconciliationMatches = pgTable(
  "ledger_reconciliation_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ledgerReconciliationSessions.id, { onDelete: "cascade" }),
    bankLineId: uuid("bank_line_id")
      .notNull()
      .references(() => ledgerBankLines.id, { onDelete: "cascade" }),
    // UNIQUE forever — one book transaction clears against exactly one bank
    // line, even after inc3's Zeffy batch matching. bankLineId is
    // deliberately NOT unique — a future batch match links many transactions
    // to one bank line; inc2's /match route enforces 1:1 at the route layer
    // only, so inc3 can lift that route-level restriction with zero schema
    // change (DECISION-036).
    transactionId: uuid("transaction_id")
      .notNull()
      .unique()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("ix_ledger_recon_matches_bank_line").on(t.bankLineId),
  ],
);
export type LedgerReconciliationMatch = typeof ledgerReconciliationMatches.$inferSelect;
export type NewLedgerReconciliationMatch = typeof ledgerReconciliationMatches.$inferInsert;
```

**Provenance column on `ledgerTransactions`** (added to the existing table,
alongside `reconciled`/`reconciledAt`):

```typescript
// Bank Reconciliation inc2 adds: reconciledSessionId — pointer to which
// session's close (if any) set reconciled/reconciledAt on this row. NULL for
// rows toggled via the legacy per-row route (out-of-band) or never
// reconciled. Reopen reverts only rows pointing at itself; the legacy toggle
// route clears this to null whenever it fires (out-of-band supersedes
// session provenance). DECISION-036 — modeled on DECISION-025's syncStale: a
// marker, not a parallel status.
reconciledSessionId: uuid("reconciled_session_id")
  .references(() => ledgerReconciliationSessions.id, { onDelete: "set null" }),
```
Plus index `index("ix_ledger_txns_reconciled_session").on(t.reconciledSessionId)`.

### Migration

**Numbering:** `0057_ledger_receipt_waiver.sql` is the latest committed file
as of this writing — claimed by the concurrent transaction-receipts work. This
increment's migration is **`00NN_ledger_reconciliation_sessions.sql`, NN
next-free at implementation time** (expect `0058`, but the implementing
database-admin must run `ls drizzle/migrations/` immediately before creating
the file — other concurrent work may claim a slot first, exactly as `0056`
had to yield to `0054`/`0055` during inc1).

```sql
-- 00NN_ledger_reconciliation_sessions.sql (idempotent)

CREATE TABLE IF NOT EXISTS ledger_reconciliation_sessions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id         uuid        NOT NULL REFERENCES ledger_bank_accounts(id) ON DELETE CASCADE,
  statement_period_start  date        NOT NULL,
  statement_period_end    date        NOT NULL,
  opening_balance_cents   integer     NOT NULL,
  closing_balance_cents   integer     NOT NULL,
  status                  text        NOT NULL DEFAULT 'open',
  uploaded_at             timestamptz,
  csv_filename            text,
  csv_row_count           integer,
  closed_at               timestamptz,
  closed_by_user_id       uuid        REFERENCES users(id) ON DELETE SET NULL,
  reopened_at             timestamptz,
  reopened_by_user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_recon_sessions_account_period_key') THEN
    ALTER TABLE ledger_reconciliation_sessions
      ADD CONSTRAINT ledger_recon_sessions_account_period_key
      UNIQUE (bank_account_id, statement_period_start, statement_period_end);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_recon_sessions_account
  ON ledger_reconciliation_sessions (bank_account_id, statement_period_end);

CREATE TABLE IF NOT EXISTS ledger_bank_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid        NOT NULL REFERENCES ledger_reconciliation_sessions(id) ON DELETE CASCADE,
  bank_account_id      uuid        NOT NULL REFERENCES ledger_bank_accounts(id) ON DELETE CASCADE,
  posting_date         date        NOT NULL,
  description          text        NOT NULL,
  amount_cents         integer     NOT NULL,
  raw_type             text,
  check_or_slip_number text,
  balance_cents        integer,
  in_statement_period  boolean     NOT NULL DEFAULT true,
  dedupe_key           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_bank_lines_session_dedupe_key') THEN
    ALTER TABLE ledger_bank_lines
      ADD CONSTRAINT ledger_bank_lines_session_dedupe_key UNIQUE (session_id, dedupe_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_bank_lines_session_period
  ON ledger_bank_lines (session_id, in_statement_period);
CREATE INDEX IF NOT EXISTS ix_ledger_bank_lines_check_slip
  ON ledger_bank_lines (bank_account_id, check_or_slip_number);

CREATE TABLE IF NOT EXISTS ledger_reconciliation_matches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES ledger_reconciliation_sessions(id) ON DELETE CASCADE,
  bank_line_id        uuid        NOT NULL REFERENCES ledger_bank_lines(id) ON DELETE CASCADE,
  transaction_id      uuid        NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_recon_matches_txn_key') THEN
    ALTER TABLE ledger_reconciliation_matches
      ADD CONSTRAINT ledger_recon_matches_txn_key UNIQUE (transaction_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_recon_matches_bank_line
  ON ledger_reconciliation_matches (bank_line_id);

ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS reconciled_session_id uuid
  REFERENCES ledger_reconciliation_sessions(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_reconciled_session') THEN
    CREATE INDEX ix_ledger_txns_reconciled_session ON ledger_transactions (reconciled_session_id);
  END IF;
END $$;
```

**Implementer note:** confirm at implementation time whether `0057`'s
`receipt_storage_key` rename has landed in `schema.ts` before adding this
increment's block — both edits touch `ledgerTransactions`'s definition and
must land as two sequential diffs, not a race (same discipline inc1 named for
the concurrent failed-login work).

## Component / Page Plan

**Pages** (new):
- `src/app/(dashboard)/admin/ledger/reconciliation/page.tsx` — session list,
  server component, `LEDGER_VIEW` gate; grouped by entity/account, "New
  session" CTA gated client-side on `LEDGER_RECORD` (from session features).
  Empty state: `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No
  reconciliation sessions yet for this account — start one."
- `src/app/(dashboard)/admin/ledger/reconciliation/[sessionId]/page.tsx` —
  session detail, server component fetching via `getReconciliationSession()`
  (`reconciliation-queries.ts`); renders the upload form (if `!uploadedAt`),
  tie-out summary, matching grid, and close/reopen actions.

**Components** (new, `src/components/admin/ledger/`):
- `new-reconciliation-session-form.tsx` — account picker (query-filtered
  `accountType !== 'cash'`, server-validated again per the route contract),
  period start/end date inputs, opening/closing balance inputs; surfaces
  `gapWarning` from the create response as an inline notice, not a blocker.
- `reconciliation-session-list.tsx` — table, `rounded-2xl` card wrapper,
  `overflow-x-auto` per the existing `uncashed-checks-panel.tsx` mobile
  convention; status badge (Open/Closed).
- `reconciliation-csv-upload.tsx` — file input + upload button; surfaces the
  named header-validation error or row-parse error verbatim, not a generic
  toast.
- `reconciliation-tie-out-summary.tsx` — opening/cleared/closing/delta,
  balanced/unbalanced state; Close button disabled until `balanced &&
  unmatchedInPeriodCount === 0`.
- `reconciliation-matching-grid.tsx` — in-period bank lines table with
  inline "Match" / "Unmatch" / "Create transaction" actions; a visually
  distinct, clearly-labeled collapsed section for out-of-period lines (never
  mixed into the primary grid, per Phase 1 Pass 4).
- `reconciliation-match-picker.tsx` — dialog listing candidate unreconciled
  posted transactions for this bank account (searchable by amount/date/
  party), single-select, confirms via `POST .../match`.
- `reconciliation-create-from-bank-line-dialog.tsx` — pre-filled transaction
  form (date/amount/description from the bank line; `checkNumber` pre-fill
  per the deposit-slip rule above), submits to
  `POST .../create-from-bank-line`.
- `reconciliation-reopen-button.tsx` — `LEDGER_MANAGE`-gated, wraps
  `<ConfirmDialog>` per Flow F, states plainly which rows will revert
  (`revertedTxnCount` from a dry-run `GET`, or simply "rows cleared by this
  session" — implementer's call on exact copy).

All cards `rounded-2xl`, all buttons `rounded-lg`, no `rounded-full`, no
native dialogs — `<ConfirmDialog>` for reopen (a real action against the
audit trail) and recommend also for unmatch (Phase 1's recommendation,
confirmed here: unmatching reverts a staged decision, cheap enough action
that a lightweight confirm is still warranted since it's easy to fat-finger
in a dense grid).

**Files to modify:**
- `src/lib/db/schema.ts` — three new tables + `reconciledSessionId` column
  (above).
- `drizzle/migrations/00NN_ledger_reconciliation_sessions.sql` — new file
  (above).
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts` — the
  legacy per-row toggle must additionally set `reconciledSessionId: null` on
  every write (both directions), severing session provenance whenever an
  out-of-band correction happens. One-line addition to the existing
  `.set({...})` call.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` (PATCH, DELETE) — add
  a `reconciledSessionId`-set immutability guard, structurally identical to
  the existing `approvedAt` guard (403 `"This transaction was cleared by a
  closed reconciliation session — reopen it to edit or delete this row"`).
  See Edge Cases for why this is a full lock, not a partial-field lock.
- `src/components/admin/admin-sidebar.tsx` — new nav entry
  `/admin/ledger/reconciliation` under the Ledger section, alongside
  `compliance`/`donors`/`reports`/`settings`.

**New files:**
- `src/lib/reconciliation.ts` — pure functions (parser, matching-support,
  tie-out, period-overlap/gap). No DB, no Next.js import — mirrors
  `ledger.ts`'s role.
- `src/lib/reconciliation.test.ts` — named tests below.
- `src/lib/reconciliation-queries.ts` — DB-touching CRUD (sessions, bank
  lines, matches) — mirrors `ledger-queries.ts`'s role. **Does not modify
  `ledger-queries.ts`** — a separate file, per the architect's Section 4
  ruling, and also avoids touching a file the concurrent transaction-receipts
  database-admin may still be mid-edit on.
- API routes listed under API Contract, all under
  `src/app/api/admin/ledger/reconciliation/sessions/`.
- Page/component files listed above.

## Implementation Order

1. **Schema.** Three tables + `reconciledSessionId` column, in
   `src/lib/db/schema.ts`. Migration `00NN_ledger_reconciliation_sessions.sql`
   (verify next-free number at implementation time — do not assume `0058`).
   Run `pnpm db:migrate` locally; verify idempotency with a second run.
2. **Pure functions.** `src/lib/reconciliation.ts` +
   `src/lib/reconciliation.test.ts` — all 22 named tests below, written
   before wiring any route (matches this codebase's precedent of shipping
   the pure-function layer testable in isolation, per `ledger.test.ts`).
3. **Queries.** `src/lib/reconciliation-queries.ts` — session CRUD, bank-line
   insert/list, match insert/delete, candidate-transaction query, tie-out
   assembly for the detail page.
4. **Routes.** In order: create session → upload → detail (GET) → match →
   unmatch → create-from-bank-line → close → reopen. Plus the two small
   modifications to the existing reconcile/transaction routes (provenance-
   clear on toggle; immutability guard on PATCH/DELETE).
5. **UI.** List page → new-session form → detail page shell → CSV upload →
   tie-out summary → matching grid → match picker → create-from-bank-line
   dialog → close/reopen actions → sidebar nav entry.
6. Release notes entry via `/release-notes` when this increment ships (note
   in the entry that auto-match/Zeffy batch matching are still to come in
   inc3, matching inc1's precedent).

**Sequencing dependency (not mine to schedule, noting for the record):** the
database-admin implementing this must confirm the concurrent transaction-
receipts database-admin's edit to `src/lib/db/schema.ts` (migration `0057`,
the `receipt_storage_key` rename + waiver columns) has landed before adding
this increment's block — both touch `ledgerTransactions`'s definition.

## Edge Cases & Risks

- **Duplicate upload idempotency** — resolved at the session level (one
  upload per session, `uploadedAt` gate) as the primary defense, with a
  row-level `(session_id, dedupe_key)` unique constraint as defense-in-depth
  against a literally self-duplicated CSV. Cross-session duplicate uploads
  (the same period uploaded to two different sessions) are prevented one
  layer up, by the period-overlap check at session creation — you cannot
  create a second session that could receive the same statement period.
- **Overlapping periods** — hard-blocked at session creation (409); enforced
  against periods of *any* status (open or closed), since a closed session's
  claimed days are just as unavailable as an open one's.
- **Out-of-period rows in the CSV** — flagged (`inStatementPeriod = false`),
  visibly separated in the UI, excluded from both the "must be matched" close
  gate and the tie-out sum. Never silently dropped, never silently included.
- **Transfer pairs appearing on both accounts' statements** — confirmed no
  special-casing needed: the candidate-transaction query scopes by
  `bankAccountId`, and a transfer leg is a normal posted transaction on one
  side of the pair with its own `bankAccountId` — it surfaces in exactly the
  one session (the account whose statement it's on) it should. Matches the
  architect's Phase 2 expectation this "just works."
- **Concurrent (non-overlapping) open sessions on the same account** —
  explicitly allowed. Nothing in this design serializes session creation; the
  historical-backlog use case benefits from being able to open several past
  months at once and work through them over time. Multi-*user* concurrent
  editing of the *same* session is an explicit non-goal carried from Phase 1
  (single active treasurer) — no locking mechanism designed.
- **Reopen-after-later-session-closed ordering** — named, enforced rule (API
  Contract, reopen route step 2): reopening a session is blocked if any
  *later-period* session on the same account is already closed. This is the
  standard bank-rec discipline (you can't safely revisit an earlier period
  once later periods have been built and finalized on top of the books as
  they stood at that time).
- **Reconciled-row immutability (edit-after-clear)** — resolved as a **full
  lock**, not a partial-field or `syncStale`-style silent-degradation lock.
  A transaction with `reconciledSessionId` set cannot be edited (any field)
  or deleted via the standard PATCH/DELETE routes until the closing session
  is reopened — structurally identical to the existing `approvedAt` guard,
  reusing the same 403 idiom. This was a genuine choice point (the architect
  flagged `syncStale` reuse as *a* reasonable option): I chose the harder
  lock because this feature's defining decision is a **hard** tie-out with no
  discrepancy-note escape hatch — silently degrading a closed session's
  arithmetic via an unflagged edit would contradict that decision's spirit.
  `syncStale` remains reserved for its original, narrower purpose (a
  dues-payment source edit after ledger reconcile, DECISION-025) and is not
  overloaded here.
- **Signed vs. positive-only amount representation** — `ledger_bank_lines
  .amountCents` is deliberately **signed** (Chase's own convention: positive
  = credit, negative = debit), diverging from `ledgerTransactions`'
  always-positive-plus-`flow` model. Bank lines are a staging/parse concept
  with no `flow` semantics of their own (a bank line isn't income or expense
  until matched to a book row that has a `flow`); forcing a
  sign-to-flow translation at parse time would be a lossy, premature
  interpretation this table doesn't need to make.
- **Pending Chase rows** — this codebase has no confirmed evidence that
  Chase's *closed-period* activity export includes pending transactions (the
  Phase 1 concern may prove moot for a historical period's export); the
  parser tolerates an optional pending indicator if present but defaults
  every row to settled when absent. Flagging for qa to confirm against a
  real exported file during Phase 5, since this was never independently
  verified against an actual Chase export in this design.
- **NULL `check_number` on candidate transactions is a live case** (inc1
  Phase 6 note) — the matching UI and candidate query must treat it as
  ordinary, not an error state; nothing in this design requires a non-null
  `checkNumber` anywhere in the matching path.
- **CSV input boundaries** — 2MB size cap, UTF-8 validation, empty/header-only
  rejection, all with named errors (API Contract, upload route). No new
  formula-injection escaping at import time (architect's Section 7 ruling);
  if `description`/`checkOrSlipNumber` ever reach the existing ledger CSV
  export (`src/app/api/admin/ledger/export/route.ts`), they must route
  through the existing `csvCellSafe()` calls there — this increment does not
  add them to that export, so no action needed unless a future increment
  does.

## Named Unit Tests (Vitest) — `src/lib/reconciliation.test.ts`

`validateChaseCsvHeader()`:
1. Valid full header (`Posting Date, Description, Amount, Type, Balance,
   Check or Slip #`) → `{ valid: true }`.
2. Missing `Posting Date` → `{ valid: false, error }` where `error` names
   "Posting Date" specifically (Flow A's literal example).
3. Missing `Check or Slip #` → error names that column specifically.
4. Header columns present but reordered → still `{ valid: true }`
   (order-independent, name-keyed lookup).
5. Header names with stray whitespace/case variance (`" posting date "`) →
   still `{ valid: true }` (trim + case-insensitive match).

`parseChaseCsvRow()`:
6. Debit row, `"-45.00"` → `amountCents: -4500`.
7. Credit row, `"1,234.56"` → `amountCents: 123456` (comma-thousands parsing).
8. Blank `Check or Slip #` → `checkOrSlipNumber: null`, not `""`.
9. `Check or Slip #` = `"DEP"` on a credit row → stored verbatim as `"DEP"`,
   no special validation or rejection (deposit-slip ruling: storage is raw;
   interpretation is a UI/consumer concern only).
10. Unparseable `Amount` (e.g. `"N/A"`) → a named row-level error result
    identifying the row and the bad value, not a thrown exception or a
    silent `0`.

`bankLineDedupeKey()`:
11. Same inputs → same key (determinism).
12. Differing `checkOrSlipNumber` (`null` vs `"DEP"`) with identical date/
    description/amount → different keys (doesn't collapse two distinct
    lines).

`computeTieOut()`:
13. Exact balance → `{ balanced: true, deltaCents: 0 }`.
14. Off by one cent → `{ balanced: false, deltaCents: 1 }` (sign convention:
    positive delta = stated closing balance exceeds computed cleared total;
    documented in the function's doc comment).
15. Zero matched lines, opening === closing → `{ balanced: true, deltaCents: 0 }`
    (a statement period with no cleared activity).

`validatePeriodOverlap()`:
16. Back-to-back periods (`existing.end === new.start - 1 day`) → no overlap.
17. New period fully inside an existing session's period → overlap, names
    the conflicting period.
18. Partial overlap (new period starts inside, ends after, an existing
    period) → overlap.
19. Boundary case: `new.start === existing.end` (shared single day) →
    **overlap** — inclusive-boundary rule, documented explicitly in the test
    (a single calendar day cannot belong to two sessions on one account).

`computePeriodGapWarning()`:
20. `new.start === priorPeriodEnd + 1 day` → `null` (perfectly contiguous, no
    warning).
21. `new.start` more than one day after `priorPeriodEnd` → a warning string
    naming the gap length in days.
22. `priorPeriodEnd === null` (first-ever session for this account) → `null`
    (nothing to compare against).

## Out of Scope

- Auto-match (check-number-first / amount+date-window scoring), ambiguous-
  candidate surfacing, Zeffy batch matching — all inc3. This design's schema
  and route shape deliberately do not preclude them (match table's
  `bankLineId` is non-unique; `/match` route's 1:1 rule is route-level, not
  schema-level).
- Editing an already-uploaded session's CSV (replace/re-upload) — not
  supported; a mis-uploaded session has no repair path in inc2 beyond manual
  DB intervention (flagging as a real, if narrow, gap — the treasurer's
  recourse for a bad upload is to not yet have any matches recorded and to
  proceed anyway, since no close can happen without correct data; a
  dedicated "delete session" or "replace upload" affordance is a reasonable
  inc3+ follow-up if this proves painful in practice).
- Pending-transaction handling beyond a tolerant-but-unverified parser
  assumption (see Edge Cases) — qa should confirm against a real Chase
  export.
- Raw CSV file retention — explicitly parse-and-discard per the architect's
  ruling; no follow-up planned.
- Any change to the existing uncashed-checks panel or its detection logic —
  untouched by this increment.

## Implementer

**database-admin** first: schema (three tables + `reconciledSessionId`
column), migration, `src/lib/reconciliation.ts` + its full named test suite,
`src/lib/reconciliation-queries.ts`. This mirrors inc1's precedent of
database-admin owning the pure-function/parsing layer where correctness is
load-bearing for a downstream matching engine (here, inc3's auto-match will
depend on this increment's table shapes and `checkOrSlipNumber`/`amountCents`
semantics being right).

Then **api-developer**: all eight route files under
`src/app/api/admin/ledger/reconciliation/sessions/`, plus the two small
modifications to the existing reconcile/transaction routes (provenance-clear
on toggle; immutability guard on PATCH/DELETE).

Then **ux-developer**: list page, detail page, and all eight new components,
plus the `admin-sidebar.tsx` nav entry.

This is the specialist split (database-admin → api-developer → ux-developer)
the architect named in Phase 2 — confirmed appropriate here given the size:
new table set, eight route handlers with a hard server-side tie-out gate, and
a genuinely new matching-grid UI pattern. Not a candidate for full-stack-
developer.

### Outputs

- `docs/work-log/2026-07-21-ledger-reconciliation-sessions.md` — this file.
- `docs/work-log/2026-07-21-bank-reconciliation.md` — parent Phase 3 section
  updated to note inc2 designed, and the Per-Phase Status row's "In progress"
  note extended.
- `docs/decisions.md` — new **DECISION-036** entry (next free number after
  DECISION-035).
- No source files touched (design-only per this task's boundary; a
  database-admin is concurrently editing `schema.ts` / `drizzle/migrations/`
  / `ledger-queries.ts` for the transaction-receipts feature right now).

### Open questions / handoff notes

- **Next: database-admin** for schema + migration + `reconciliation.ts` (+
  tests) + `reconciliation-queries.ts`, per Implementer above. Must verify
  the next-free migration number at implementation time (expect `0058+`) and
  confirm the concurrent transaction-receipts `schema.ts` edit (migration
  `0057`) has landed before adding this increment's block.
- Then **api-developer** for the eight route files + the two existing-route
  modifications.
- Then **ux-developer** for the list/detail pages and eight components +
  sidebar nav entry.
- **Real Chase CSV export needed for qa's Phase 5** — this design's header/
  parsing assumptions (column set, pending-row handling) are inferred from
  the parent Intent's description, not verified against an actual exported
  file. qa should obtain (or have the treasurer provide) a real sample export
  before signing off, and flag to the next tech-lead if the real file's shape
  differs from what's assumed here.
- inc3 (`2026-07-21-ledger-auto-match`, not yet designed) can build directly
  on this increment's `ledger_reconciliation_matches` shape (bankLineId
  non-unique) and the `ix_ledger_bank_lines_check_slip` /
  `ix_ledger_txns_check_number` (inc1) indexes without any schema change.

---

# Phase 4 — Implementation

## Increment A — database-admin (schema + migration + parser lib) — 2026-07-21

**Owner:** database-admin
**Status:** complete

### Summary

Implemented the three new tables, the `reconciledSessionId` provenance
column, an idempotent migration, the full `reconciliation.ts` pure-function
layer (header validation, row normalization, dedupe-key derivation, tie-out
arithmetic, period-overlap/gap checks) with all 22 named Vitest tests, and
`reconciliation-queries.ts` (session CRUD, bank-line insert/list, match
insert/delete, candidate-transaction query, tie-out assembly). Typecheck,
full test suite (432 tests, up from 407), and `pnpm build:only` all pass.

### What I did

Read the full inc2 design doc (this file) and the parent work-log's Phase
1-2 (both User-decisions blocks: hard-block tie-out, historical periods
supported) and Phase 2 architect ruling (§3 same-columns/no-parallel-state,
§7 CSV-safety direction). Read `src/lib/db/schema.ts` in full for
`ledgerBankAccounts`/`ledgerTransactions`/`ledgerBudgets`/`ledgerSettings`/
`ledgerFilings`/`failedLoginAttempts` to confirm placement and the
timestamp-column convention. Read `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`
(function inventory + `getPendingApprovals`'s explicit-column select
pattern), `src/lib/csv-safe.ts`, `src/lib/check-number.ts` +
`check-number.test.ts` (inc1's pure-function/test-file precedent — same
tech-lead design lineage), `src/lib/dues-ledger-sync.ts` (the
`DrizzleTransaction` type-inference pattern and the "atomic writes live in
the route handler, not the query-layer" convention, confirmed by inspecting
`src/app/api/admin/ledger/transactions/[id]/route.ts`'s inline
`db.transaction()` blocks), and `drizzle.config.ts` / `drizzle/run-migrations.mjs`.

Ran `ls drizzle/migrations/*.sql | sort | tail -5` at implementation
time (not trusting the design doc's "expect 0058" note) — found `0058_ledger_public_note.sql`
already claimed by concurrent work; used **`0059`**. Confirmed the
transaction-receipts `receipt_storage_key` rename (migration `0057`) had
already landed in `schema.ts` before adding this increment's block, per the
design doc's explicit sequencing note.

**Timestamp-column decision:** the task instructions for this increment were
explicit — "All timestamptz, never naive timestamps." The design doc's own
schema.ts snippet used plain `timestamp(...)` (no `withTimezone`) while its
raw migration SQL used `timestamptz`, an internal inconsistency in the design
doc. I resolved it by using `timestamp("col", { withTimezone: true })` in
TS and `timestamptz` in SQL throughout the three new tables — consistent
with both the explicit instruction and the codebase's *newest* precedent
(`ledgerFilings`, `failedLoginAttempts` both use `{ withTimezone: true }`),
even though it diverges from this file's *older* ledger tables
(`ledgerEntities`..`ledgerReimbursements`), which predate that convention and
remain naive timestamps — a pre-existing, unrelated inconsistency I did not
touch.

**Mandatory downstream fix (not scope creep):** adding `reconciledSessionId`
to `ledgerTransactions.$inferSelect` broke `getPendingApprovals()` in
`src/lib/ledger-queries.ts` (`PendingApprovalRow = LedgerTransaction & {...}`
via an explicit column-by-column `.select({...})`, missing the new column).
Fixed with a one-line addition (`reconciledSessionId: ledgerTransactions.reconciledSessionId,`)
mirroring the existing pattern for every other column in that select — this
was required for `tsc --noEmit` to pass, not a discretionary touch of a file
outside my assigned scope.

**Migration verification:** ran `pnpm db:migrate` against `.env.local` twice.
First run applied cleanly (interleaved with unrelated earlier-migration
NOTICEs from an out-of-order local DB state — `0057`/`0058` columns already
existed from a prior local apply). Second run produced only "already
exists, skipping" NOTICEs for every object this migration creates — zero
errors — proving idempotency. Verified every object via `psql \d` on all
three new tables plus `ledger_transactions`: exact column types, the
three-column composite unique constraint on sessions, the
`(session_id, dedupe_key)` unique on bank lines, `transaction_id` UNIQUE +
`bank_line_id` NOT unique on matches, and the new
`reconciled_session_id` FK + index on `ledger_transactions` — all match the
design doc exactly.

Ran `pnpm db:push --force` to check `schema.ts` against the live DB and hit
a pre-existing, unrelated interactive-prompt blocker (`ledger_entities_slug_unique`
— that table's unique constraint already exists under a different
constraint name, `ledger_entities_slug_key`, from an earlier manual/migration
path; drizzle-kit wants to rename it and asks a truncate-confirmation
question that requires a TTY even under `--force`). This is unrelated to
any table I touched (`ledger_entities` isn't part of this increment) and
predates my changes — flagging for the next database-admin/deployment-engineer
rather than force-fixing an unrelated table while implementing this feature.
My three new tables and the `reconciledSessionId` column were created via
the idempotent SQL migration directly and independently verified via `psql`
to match `schema.ts` exactly, so this blocker does not affect this
increment's correctness.

Wrote `src/lib/reconciliation.ts`: `splitCsvLine()` (RFC4180-minimal quoted-field
CSV splitter, not one of the 22 named tests but needed by any caller turning
raw file text into rows — 3 extra tests included), `validateChaseCsvHeader()`,
`parseChaseCsvRow()` (with `parseSignedDollarsToCents()` and `parseChaseDate()`
internal helpers), `bankLineDedupeKey()`, `computeTieOut()`,
`validatePeriodOverlap()`, and `computePeriodGapWarning()` (with a UTC-safe
`daysBetweenUTC()` internal helper — deliberately avoiding
`new Date("YYYY-MM-DD")` local-time parsing given this project's known
naive-timestamp-as-UTC bug class). Wrote `src/lib/reconciliation.test.ts`
with all 22 named tests plus 3 for `splitCsvLine`.

Wrote `src/lib/reconciliation-queries.ts`: session list/CRUD, period-overlap/gap
read helper (`getSessionPeriodsForAccount`), bank-line bulk insert
(`onConflictDoNothing` on `(sessionId, dedupeKey)`) + list-with-match-state,
candidate-transaction query (LEFT JOIN + `IS NULL` against the matches
table, posted + unreconciled + same bank account), match CRUD, tie-out
assembly (`getTieOutAssembly` — single pass over in-period bank lines,
splits into matched-amounts vs. unmatched-ids), and the reopen-ordering
read helper (`getLaterClosedSessionForAccount`). Per this codebase's
established convention (confirmed via `dues-ledger-sync.ts` and the
transaction PATCH/DELETE route), the atomic multi-table writes for
close/reopen/create-from-bank-line are NOT implemented here — those are
written directly in the route handlers via inline `db.transaction()` blocks
by api-developer, composing these read helpers. Noted explicitly in the
file's header comment so the boundary isn't ambiguous to the next agent.

Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (432 passed, up from the
baseline 407 — 22 named + 3 `splitCsvLine` tests), and `pnpm build:only`
(succeeded, no errors/failures in output).

**Did not touch:** any route file, any component, `admin-sidebar.tsx`,
`docs/decisions.md`, `docs/treasurer-todo.md`, `docs/backlog.md`, or any
other work-log. Did not start a dev server. No git commit.

**Unrelated concurrent activity observed:** `git status` at the end of this
session shows `docs/treasurer-todo.md`, `src/components/members/impact-by-cause.tsx`
modified, and a new `docs/work-log/2026-07-21-impact-drilldown-row-layout.md`
— none of these are touched by this increment's work. Another process/agent
appears to be running concurrently against the same working tree. Flagging
for whoever reviews `git status` next so these aren't mistaken for part of
this handoff.

### Outputs

- **Schema:** `src/lib/db/schema.ts` — added `ledgerReconciliationSessions`,
  `ledgerBankLines`, `ledgerReconciliationMatches` (all three exactly as
  designed: sessions unique on `(bankAccountId, statementPeriodStart,
  statementPeriodEnd)`; bank lines unique on `(sessionId, dedupeKey)`,
  SIGNED `amountCents`; matches `transactionId` UNIQUE, `bankLineId` NOT
  unique) plus `ledgerTransactions.reconciledSessionId` (nullable FK →
  `ledgerReconciliationSessions.id`, `ON DELETE SET NULL`) and its index.
  One-line fix to `src/lib/ledger-queries.ts`'s `getPendingApprovals()`
  select (added the new column) — required for typecheck, not a feature
  change.
- **Migration:** `drizzle/migrations/0059_ledger_reconciliation_sessions.sql`
  — next-free number confirmed via `ls` at implementation time (`0058`
  already existed, claimed by concurrent `ledger_public_note` work). Every
  statement idempotent: `CREATE TABLE IF NOT EXISTS` ×3, `DO $$ ... END $$`
  guards on all three named constraints (`ledger_recon_sessions_account_period_key`,
  `ledger_bank_lines_session_dedupe_key`, `ledger_recon_matches_txn_key`),
  `CREATE INDEX IF NOT EXISTS` ×5, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  for `reconciled_session_id`, and a `DO $$` guard on its index. Applied
  twice against `.env.local` — first run clean, second run produced only
  "already exists, skipping" NOTICEs, zero errors — idempotency proven.
  Every object verified via `psql \d` against the live DB, matching
  `schema.ts` exactly.
- **Pure functions:** `src/lib/reconciliation.ts` — `splitCsvLine()`,
  `validateChaseCsvHeader()`, `parseChaseCsvRow()`, `bankLineDedupeKey()`,
  `computeTieOut()`, `validatePeriodOverlap()`, `computePeriodGapWarning()`.
  No DB import, no Next.js import.
- **Tests:** `src/lib/reconciliation.test.ts` — all 22 named tests (5 header
  validation, 5 row normalization, 2 dedupe key, 3 tie-out arithmetic, 4
  period-overlap, 3 period-gap) plus 3 for `splitCsvLine`. 25/25 passing.
- **Queries:** `src/lib/reconciliation-queries.ts` — `getReconciliationSessions`,
  `getSessionPeriodsForAccount`, `createReconciliationSession`,
  `getReconciliationSessionById`, `markSessionUploaded`, `insertBankLines`,
  `getBankLinesForSession`, `getBankLineById`,
  `getCandidateTransactionsForMatching`, `getMatchForBankLine`,
  `getMatchForTransaction`, `getMatchById`, `insertMatch`, `deleteMatch`,
  `getTieOutAssembly`, `getMatchedTransactionIdsForSession`,
  `getLaterClosedSessionForAccount`. Explicitly does NOT implement the
  atomic close/reopen/create-from-bank-line multi-table writes — those
  belong in api-developer's route handlers per this codebase's established
  `db.transaction()`-in-the-route-handler convention.
- **Local apply commands:**
  `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (run twice, idempotent) — `pnpm db:push --force` hit the pre-existing,
  unrelated `ledger_entities` constraint-naming blocker described above;
  not resolved as out of scope for this increment.
- **Gates:** `pnpm exec tsc --noEmit` clean. `pnpm test` — 432/432 passing
  (407 pre-existing + 25 new). `pnpm build:only` — succeeded, no
  errors/failures.

### Open questions / handoff notes

- **Next: api-developer** for the eight route files under
  `src/app/api/admin/ledger/reconciliation/sessions/` plus the two small
  modifications to the existing reconcile/transaction routes
  (provenance-clear on the legacy toggle; immutability guard on PATCH/DELETE
  when `reconciledSessionId` is set) — per the design doc's API Contract and
  Files to Modify sections.
- **Atomic writes are route-handler territory, not query-layer:** per this
  codebase's established convention (confirmed via `dues-ledger-sync.ts` and
  `transactions/[id]/route.ts`), api-developer should write the close/reopen/
  create-from-bank-line `db.transaction()` blocks directly in the route
  files, composing the read helpers in `reconciliation-queries.ts` (e.g.
  `getTieOutAssembly()` + `getMatchedTransactionIdsForSession()` for close;
  `getLaterClosedSessionForAccount()` for reopen's ordering gate) rather than
  expecting a pre-built transactional helper — none was built here,
  deliberately.
- **`getBankLinesForSession()` / `getTieOutAssembly()` assume ≤1 match per
  bank line** (true for inc2 — the `/match` route enforces 1:1 at the route
  layer). If inc3 ships Zeffy batch matching before this shape is revisited,
  these two functions' LEFT JOIN will need to aggregate rather than take the
  first joined row.
- **`pnpm db:push --force` blocker on `ledger_entities_slug_unique`** —
  pre-existing, unrelated to this increment (that table's unique constraint
  already exists under the name `ledger_entities_slug_key`; drizzle-kit's
  non-interactive `--force` path still requires a TTY for this specific
  rename-or-truncate prompt). Not fixed here. Whoever next runs `db:push`
  against this same local DB will hit it too — worth a dedicated
  constraint-rename migration at some point, but out of scope for this
  reconciliation-sessions increment.
- **Real Chase CSV export still needed for qa's Phase 5** (carried forward
  from the design doc, unchanged by this increment) — the header/parsing
  assumptions in `reconciliation.ts` are inferred from the parent Intent's
  description, not verified against an actual exported file.
- **Then ux-developer** for the list/detail pages, eight components, and the
  `admin-sidebar.tsx` nav entry, once api-developer's routes exist.

---

## Increment B — api-developer (routes) — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary

Implemented all eight route files under
`src/app/api/admin/ledger/reconciliation/sessions/` plus the two named edits
to existing routes (provenance-clear on the legacy reconcile toggle;
`reconciledSessionId` full-lock immutability guard on the transaction
PATCH/DELETE routes, including the transfer-pair partner check). All atomic
multi-table writes (close, reopen, create-from-bank-line) are inline
`db.transaction()` blocks in the route handlers, composing Increment A's read
helpers — per the codebase convention Increment A's handoff named explicitly.
Typecheck, full test suite (432/432, unchanged — no new named unit tests were
assigned to this increment; all 22 from the Phase 3 design doc are pure
functions already delivered and tested in Increment A), and `pnpm build:only`
all pass. No `console.log` in any new or edited file.

### What I did

Read this file in full (Phase 3 design doc's API Contract, Data Model,
Implementation Order, Edge Cases, and Increment A's handoff notes) and the
parent work-log's Phase 1 five-pass review and both User-decisions blocks
(hard-block tie-out, historical periods supported). Read
`src/lib/reconciliation.ts` and `src/lib/reconciliation-queries.ts` in full to
confirm every pure function and query helper's exact signature before wiring
routes against them. Read the existing reconcile-toggle route
(`transactions/[id]/reconcile/route.ts`) and the transaction PATCH/DELETE
route (`transactions/[id]/route.ts`) in full — the latter's `approvedAt`/
`status==='rejected'` guard shape (single-row and transfer-pair-partner
variants) is what the new `reconciledSessionId` guard mirrors exactly, per
the design doc's explicit instruction. Read the existing
`POST /api/admin/ledger/transactions` route in full for the fund/category/
party/paymentMethod/checkNumber validation shape reused (duplicated, not
imported — see deviation note below) by create-from-bank-line, and its
transfer-handler for the `db.transaction()` idiom. Read
`src/app/api/members/reimbursements/upload/route.ts` for the
`request.formData()` multipart convention mirrored by the CSV-upload route.
Read `src/app/api/admin/ledger/filings/route.ts`'s Postgres-error-code
unwrapping helper (23505 → clean 409) and reused the same pattern for the
`/match` route's `transactionId`-unique race. Read `src/app/api/admin/ledger/
donors/route.ts` and `reimbursements/route.ts` for the list-response wrapper
convention (`{ donors, total }` / `{ reimbursements, total }`) — used
`{ sessions }` for the list route. Confirmed the `[id]/subresource/route.ts`
nesting convention (`reimbursements/[id]/receipt/route.ts`) as precedent for
`[sessionId]/upload`, `/match`, `/match/[matchId]`, `/create-from-bank-line`,
`/close`, `/reopen`.

Wrote all eight route files (below), then made the two named edits to
existing routes. Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (432/432,
unchanged from Increment A's baseline), `pnpm build:only` (succeeded — all
eight new routes appear in the build's route manifest), and
`grep -rn "console.log"` across every new/edited file (zero hits). Did not
start a dev server; did not touch `schema.ts`, any migration,
`src/lib/reconciliation.ts`, `src/lib/reconciliation-queries.ts`, any
component, `admin-sidebar.tsx`, or any other work-log. No git commit.

### Outputs — API contract for ux-developer

All routes require `auth()` (401 if absent), then `hasFeature()` (403).

| Method + Path | Gate | Request | Response |
|---|---|---|---|
| `GET /api/admin/ledger/reconciliation/sessions` | `LEDGER_VIEW` | query: `entityId?`, `bankAccountId?`, `status?` ('open'\|'closed') | 200 `{ sessions: ReconciliationSessionListRow[] }` |
| `POST /api/admin/ledger/reconciliation/sessions` | `LEDGER_RECORD` | `{ bankAccountId, statementPeriodStart, statementPeriodEnd, openingBalanceCents, closingBalanceCents }` | 201 `{ id, ...session, gapWarning?: string }`; 404 bad account; 400 validation/cash-account; 409 `{ error, conflictingSessionId }` on overlap |
| `GET /api/admin/ledger/reconciliation/sessions/[sessionId]` | `LEDGER_VIEW` | — | 200 `{ session, bankLines: BankLineWithMatch[], candidateTransactions: CandidateTransactionRow[], tieOut }`; 404 |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/upload` | `LEDGER_RECORD` | multipart/form-data, field `file` | 201 `{ sessionId, rowCount, outOfPeriodCount, gapWarning: null }`; 400 header/parse/empty errors (named); 404; 409 not-open or already-uploaded; 413 >2MB |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match` | `LEDGER_RECORD` | `{ bankLineId, transactionId }` | 201 `{ matchId, bankLineId, transactionId }`; 400 not-posted/wrong-account; 404; 409 already-matched/already-reconciled |
| `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]` | `LEDGER_RECORD` | — | 200 `{ deleted: true }`; 404; 409 session not open |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/create-from-bank-line` | `LEDGER_RECORD` | `{ bankLineId, fundId, categoryId?, party?, memo?, flow, paymentMethod?, checkNumber? }` | 201 `{ transactionId, matchId }`; 400 validation; 404 fund/category/bank-line/session; 409 not-open or already-matched |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close` | `LEDGER_RECORD` | — | 200 `{ sessionId, status: 'closed', clearedCount }`; 400 unmatched lines / not-posted / doesn't-balance (with `deltaCents`); 404; 409 not open |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/reopen` | **`LEDGER_MANAGE`** | — | 200 `{ sessionId, status: 'open', revertedTxnCount }`; 404; 409 not closed / later-period session already closed (`blockingSessionId`) |

**Existing-route edits (no new endpoints):**
- `POST /api/admin/ledger/transactions/[id]/reconcile` — every write now also
  sets `reconciledSessionId: null` (both directions). No contract change,
  same request/response shape as before.
- `PATCH`/`DELETE /api/admin/ledger/transactions/[id]` — now also return 403
  `"This transaction was cleared by a closed reconciliation session — reopen
  it to edit or delete this row"` when `reconciledSessionId` is set (checked
  alongside the existing `approvedAt` guard, including the transfer-pair
  partner-row variant in both handlers). No other contract change.

### Atomicity approach per write path

- **Close** (`close/route.ts`): one `db.transaction()` — bulk `UPDATE
  ledger_transactions SET reconciled/reconciledAt/reconciledSessionId WHERE id
  IN (matched ids)` (skipped entirely when zero matched ids — a session with
  no cleared activity), then `UPDATE ledger_reconciliation_sessions SET
  status='closed', closedAt, closedByUserId`.
- **Reopen** (`reopen/route.ts`): one `db.transaction()` — `UPDATE
  ledger_transactions ... WHERE reconciledSessionId = $sessionId` (provenance
  pointer, not a timestamp heuristic — `.returning({id})` gives the exact
  `revertedTxnCount`), then `UPDATE ledger_reconciliation_sessions SET
  status='open', reopenedAt, reopenedByUserId, closedAt=null,
  closedByUserId=null`.
- **Create-from-bank-line** (`create-from-bank-line/route.ts`): one
  `db.transaction()` — insert the new `ledger_transactions` row, then insert
  the `ledger_reconciliation_matches` row linking it to the bank line, inside
  the same `tx`.
- **Match** (`match/route.ts`): single-row insert, not a transaction — no
  second table write accompanies it in inc2 (matching does not touch
  `reconciled`/`reconciledAt`, per architect's Ruling 3). Wrapped in a
  try/catch that maps a `23505` unique-violation on `transactionId` (a
  concurrent request racing past the pre-check) to a clean 409, mirroring
  `filings/route.ts`'s existing pattern.
- All four inline `db.transaction()` blocks live directly in the route
  handlers, composing Increment A's read helpers
  (`getTieOutAssembly`/`getMatchedTransactionIdsForSession` for close;
  `getLaterClosedSessionForAccount` for reopen's ordering gate) — per
  Increment A's explicit handoff note that this codebase's convention keeps
  atomic writes in the route layer, not the query layer.

### Test counts / gate results

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 432/432 passing (unchanged from Increment A's baseline). The
  Phase 3 design doc's "Named Unit Tests" section names 22 tests, all against
  `reconciliation.ts` pure functions — all 22 (plus 3 for `splitCsvLine`) were
  already written and passing in Increment A. No unit tests were named
  against route-layer code in the design doc, so none were added here; qa's
  Phase 5 click-through and any route-level integration tests it adds are the
  first coverage of the HTTP layer itself.
- `pnpm build:only` — succeeded; all eight new routes appear in the build's
  route manifest (verified via grep on the build output).
- `console.log` sweep — zero hits across all new/edited files.
- No git commit (per task boundary).

### Deviations from the design doc

- **Create-from-bank-line's shared validation is duplicated, not imported.**
  The design doc says fund/category/party/paymentMethod/checkNumber
  validation should be "reused, not reinvented — factor into a helper both
  routes call, or call the existing route's internal validator if it's
  already extractable." The existing `POST /api/admin/ledger/transactions`
  route's validators (`isValidFlow`, `isValidMethod`, `normalizeCheckNumber`,
  etc.) are module-scoped, not exported. Extracting them would mean editing
  that route file — a third edit to an existing route beyond the two the
  design doc explicitly named as this increment's scope. I chose to duplicate
  the ~30 lines of validation logic in the new route instead, keeping the
  existing-file edit surface to exactly the two named edits. This mirrors the
  codebase's own existing precedent of duplicating these same small
  validators across `transactions/route.ts` and `transactions/[id]/route.ts`
  rather than sharing them. Flagging for tech-lead/architect in case a future
  increment wants an actual shared validator module — not done here as an
  unrequested refactor.
- **Defensive zero-amount-bank-line rejection** in create-from-bank-line (400
  if `Math.abs(bankLine.amountCents) === 0`) — not named in the design doc,
  added because `ledgerTransactions.amountCents` must be `> 0` at the app
  layer everywhere else in this codebase (`validateAmount()` in the existing
  transactions route). A zero-amount Chase row is not an anticipated real
  case but would otherwise silently violate that invariant.
- **Unique-violation-to-409 mapping** in `/match` — not explicitly named in
  the design doc's route contract (which already covers the common case via
  a pre-insert `getMatchForTransaction`/`getMatchForBankLine` check), added
  as defense-in-depth against a genuine concurrent-request race, reusing
  `filings/route.ts`'s existing error-unwrapping pattern rather than
  inventing a new one.
- Everything else (validation order, status codes, exact error strings,
  atomicity boundaries, gate assignments) follows the design doc's API
  Contract section verbatim.

### Open questions / handoff notes

- **Next: ux-developer** for the list page
  (`src/app/(dashboard)/admin/ledger/reconciliation/page.tsx`), detail page
  (`.../[sessionId]/page.tsx`), all eight components named in the design
  doc's Component/Page Plan, and the `admin-sidebar.tsx` nav entry. The API
  contract table above has every request/response shape needed.
- **Session detail response shape** (`GET .../sessions/[sessionId]`) nests
  everything the design doc asked for under one top-level object with three
  keys — `session`, `bankLines`, `candidateTransactions`, `tieOut` — rather
  than a flatter shape. Flagging explicitly since the design doc's prose
  didn't pin an exact envelope; ux-developer should destructure from this
  shape rather than assume a flatter one.
- **Match picker candidate list is NOT scoped to bank-line amount/date** —
  per the design doc ("No amount/date agreement check in inc2 — the human's
  judgment is the entire matching engine this increment"), `candidateTransactions`
  is every unreconciled posted transaction on this account, full stop. The
  UI is expected to do any client-side sort/filter/search (the design doc's
  Component Plan mentions "searchable by amount/date/party" for
  `reconciliation-match-picker.tsx`) — the API deliberately does not
  pre-filter or rank.
- **Upload route's `rowNumber` in parse-failure errors is 1-indexed among
  non-blank data rows only** (header row and any blank lines are excluded
  from the count) — worth surfacing verbatim in the upload UI's error toast
  since it names the exact bad row + value.
- **Real Chase CSV export still needed for qa's Phase 5** (carried forward
  unchanged from the design doc and Increment A) — parsing assumptions were
  never verified against an actual export.
- ESLint (`pnpm lint`) is currently broken in this environment for an
  unrelated reason — a `minimatch`/`@eslint/eslintrc` ESM interop error that
  reproduces on a clean `git stash` too (not caused by this increment's
  files). Flagging for deployment-engineer's dependency review; did not
  attempt a fix here since it would mean touching `package.json`/lockfile
  outside this increment's scope.

---

## Increment C — ux-developer (pages + components + nav) — 2026-07-21

**Owner:** ux-developer
**Status:** complete

### Summary

Built the two pages, all eight named components, and the sidebar nav entry
from the Phase 3 Component/Page Plan. The workbench flow is: create a
session (account picker excludes cash accounts) → upload a Chase CSV →
review in-period bank lines in the matching grid, either picking an existing
book row (match picker, client-side search) or minting a new posted
transaction from the line (create-from-bank-line dialog, deposit-slip
checkNumber rule applied) → watch the tie-out delta update → Close once
balanced (hard gate, disabled client-side and re-checked server-side) →
Reopen (LEDGER_MANAGE-gated, `ConfirmDialog` destructive) if a mistake needs
fixing. Typecheck clean, full suite still 432/432 (no new unit tests were
assigned to this increment — all 22 named tests are pure-function tests
Increment A already owns), and `pnpm build:only` succeeds with both new
pages (`/admin/ledger/reconciliation`, `/admin/ledger/reconciliation/[sessionId]`)
in the route manifest.

### What I did

Read this file in full (Phase 3 design doc's Component/Page Plan, Data
Model, and both prior increments' handoff notes) and the parent work-log's
Phase 1 five-pass review + both User-decisions blocks (hard-block tie-out,
historical periods supported). Read all eight of Increment B's route files
in full to get the exact request/response shape for every endpoint
(including the session-detail envelope's `{ session, bankLines,
candidateTransactions, tieOut }` nesting, which the design doc's prose
didn't pin down, per Increment B's explicit flag) and `src/lib/reconciliation.ts`
/ `src/lib/reconciliation-queries.ts` for every exported type
(`ReconciliationSessionListRow`, `ReconciliationSessionDetail`,
`BankLineWithMatch`, `CandidateTransactionRow`, `TieOutResult`). Read
existing UI precedent before writing anything: `uncashed-checks-panel.tsx`
(overflow-x-auto table + local `formatDollars`/`formatDate` helper
convention — confirmed via grep that every ledger component defines these
locally, no shared util exists, so I did not introduce one), `reconcile-toggle.tsx`
(optimistic client mutation pattern), `transaction-form.tsx` (fund/category/
flow/party/paymentMethod/checkNumber field conventions and the
category-reset-on-fund-change effect I reused in the create-from-bank-line
dialog), `filing-form-dialog.tsx` (the "button trigger + Radix Dialog + form
bundled in one file" convention I followed for the new-session form, match
picker, and create-from-bank-line dialog), `donors/page.tsx` (server
component calling query functions directly rather than fetching its own API
route — confirmed this is the established pattern and used it for both new
pages), `confirm-dialog.tsx`, and `admin-sidebar.tsx`'s nav-item shape.
Grepped `FEATURES.LEDGER_` and `src/lib/hooks/use-permissions.ts` to confirm
gating conventions. Confirmed `getEntities()`/`getFunds()`/`getCategories()`/
`getBankAccounts()` signatures in `ledger-queries.ts` before wiring the list
page and the create-from-bank-line dialog.

Wrote all ten files (below), ran `pnpm exec tsc --noEmit` (clean), `pnpm test`
(432/432, unchanged), `pnpm build:only` (succeeded, both pages present in the
manifest), and `grep -rn "console.log\|window\.\(confirm\|alert\|prompt\)"`
across every new file (zero hits). Made the single sidebar edit last and
kept it to exactly one nav-item insertion (6 lines) to avoid colliding with
the concurrent `guide/` work also touching `admin-sidebar.tsx` — verified via
`git diff --stat` that the sidebar diff is 6 insertions, 0 deletions, nothing
else touched. Did not start a dev server. No git commit.

**Unrelated concurrent activity observed** (not touched, not mine): `docs/backlog.md`,
`docs/decisions.md` modified; new untracked
`docs/work-log/2026-07-21-membership-application-email.md`,
`docs/work-log/2026-07-21-receipt-heic-support.md`,
`docs/work-log/2026-07-21-treasury-users-guide.md`. Flagging so these aren't
mistaken for part of this handoff.

### Outputs

**Pages (new):**
- `src/app/(dashboard)/admin/ledger/reconciliation/page.tsx` — server
  component. Auth + `LEDGER_VIEW` gate (redirect `/access-pending`), status
  filter tabs (All/Open/Closed via `?status=`, mirroring the donors page's
  tab convention), cross-entity/cross-account session list, "New session"
  CTA gated client-side on `LEDGER_RECORD` (server route re-enforces).
  Eligible-account list for the picker excludes `accountType === 'cash'`.
- `src/app/(dashboard)/admin/ledger/reconciliation/[sessionId]/page.tsx` —
  server component. Fetches `getReconciliationSessionById` +
  `getBankLinesForSession` + `getCandidateTransactionsForMatching` +
  `getTieOutAssembly` (composed via `computeTieOut()`) +
  `getFunds`/`getCategories` directly — not via this feature's own API
  routes, matching the donors-page precedent. Renders upload (only when
  `!uploadedAt && isOpen && canRecord`), tie-out summary, matching grid, and
  the reopen button (only when closed and `canManage`).

**Components (new, `src/components/admin/ledger/`):**
- `reconciliation-session-list.tsx` — presentational table (no `"use client"`
  needed — pure `Link` + markup), `rounded-2xl` card, `overflow-x-auto`,
  status badges, "no statement yet" hint, empty state per convention.
- `new-reconciliation-session-form.tsx` — trigger button + Radix `Dialog` +
  form bundled in one file (filing-form-dialog.tsx convention). Account
  picker grouped by entity via `<optgroup>`. Surfaces the server's overlap
  409 and validation 400 messages verbatim; on success, a non-blocking
  `gapWarning` is a separate `toast.warning()` (never blocks navigation),
  then routes straight into the new session's workbench.
- `reconciliation-csv-upload.tsx` — file input (2MB client-side pre-check,
  matching the route's cap), surfaces the upload route's named header/parse
  errors verbatim (not a generic toast), reports `outOfPeriodCount` in the
  success toast.
- `reconciliation-tie-out-summary.tsx` — opening/cleared/closing/delta grid,
  balanced/unbalanced state, Close button disabled until `balanced &&
  unmatchedInPeriodCount === 0` and re-disabled on every render from fresh
  server data after `router.refresh()`. A raced close (someone unmatched a
  line in another tab) surfaces the server's own delta/unmatched-count
  message, never a generic failure.
- `reconciliation-matching-grid.tsx` — in-period bank-line table with inline
  Match / Unmatch / Create-transaction actions (only rendered when
  `isOpen && canRecord`); a separate, clearly-labeled collapsed section
  ("Show N rows outside this statement period") for out-of-period lines,
  never mixed into the primary grid. Owns the three child dialogs' open
  state.
- `reconciliation-match-picker.tsx` — dialog, client-side search over the
  full unfiltered `candidateTransactions` list (amount/date/party/memo/check
  #), signed-amount display for eyeballing agreement (income positive,
  expense negative) even though inc2 enforces no agreement check server-side.
- `reconciliation-create-from-bank-line-dialog.tsx` — pre-filled transaction
  form (fund/category/flow/party/memo/paymentMethod/checkNumber); date and
  amount are shown read-only from the bank line, never editable client-side,
  matching the route's server-derivation. `checkNumber` pre-fills from
  `checkOrSlipNumber` only when `amountCents < 0` (debit) per the
  deposit-slip ruling; a credit line shows an inline note explaining why its
  slip number wasn't copied in, rather than silently omitting it.
- `reconciliation-reopen-button.tsx` — `LEDGER_MANAGE`-gated (parent page
  only renders it when `canManage`), wraps `<ConfirmDialog destructive>`
  naming what will happen ("un-reconciles every transaction cleared by the
  {period} session... existing matches are kept").

**Modified:**
- `src/components/admin/admin-sidebar.tsx` — **one nav-item insertion**,
  6 lines, in the `Treasury` group immediately after the existing `Ledger`
  entry and before `Compliance` (between the original lines 91-97, now at
  lines 94-99 post-insertion): `{ name: "Reconciliation", href:
  "/admin/ledger/reconciliation", icon: "🏦", requiredFeature:
  FEATURES.LEDGER_VIEW }`. Verified via `git diff --stat` this is the file's
  *only* change (6 insertions, 0 deletions) — deliberately minimal per this
  task's sidebar-collision note.

### Gates

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 432/432 passing, unchanged (no new unit tests were assigned
  to this increment in the Phase 3 design doc — all 22 named tests are
  pure-function tests against `reconciliation.ts`, already delivered and
  passing in Increment A).
- `pnpm build:only` — succeeded. Both new pages
  (`/admin/ledger/reconciliation`, `/admin/ledger/reconciliation/[sessionId]`)
  confirmed present in the build's route manifest via grep on the build
  output.
- `grep -rn "console.log\|window\.\(confirm\|alert\|prompt\)"` across every
  new file — zero hits. Every destructive action (Close is not destructive —
  no ConfirmDialog by design, since it's reversible via Reopen; Reopen and
  Unmatch are) uses `<ConfirmDialog>` from `@/components/ui/confirm-dialog`,
  `destructive` prop set on both.
- No git commit (per task boundary).

### Deviations from the design doc

- **Close has no `<ConfirmDialog>`.** The design doc's Component Plan didn't
  explicitly call for one on Close (only naming it for Reopen and
  recommending it for Unmatch). I left Close as a plain disabled-until-ready
  button: it's the forward, expected end-state of a balanced session (not a
  surprising or hard-to-undo action — Reopen exists precisely to undo it),
  and the hard tie-out gate already prevents accidental/premature closes
  far more effectively than a confirm dialog would. Flagging this choice
  explicitly rather than silently deciding it.
- **Unmatch uses `<ConfirmDialog>` (non-destructive-severity in practice, but
  rendered with `destructive` prop).** The design doc's Component Plan
  "recommends" a confirm for unmatch as the implementer's call; I took it,
  since a dense matching grid is easy to fat-finger. Used `destructive`
  styling (red confirm button) despite unmatch being a fully reversible,
  low-stakes action — a plain (non-destructive) `<ConfirmDialog>` would have
  been equally defensible and slightly less alarming; flagging as a UX
  judgment call qa/analyst may want to soften.
- **Party pre-fill in create-from-bank-line** — the design doc says
  "pre-filled per design: date/amount/party from the line," but the API's
  `CandidateTransactionRow`/bank-line shape has no separate "party" field on
  a bank line, only `description`. I pre-fill the Payer/Payee field from
  `bankLine.description` (editable) as the closest reasonable reading of
  that instruction. Flagging in case the Lions Club treasurer would rather
  it start blank.
- **No richer "matched to" detail on a matched bank line** — `BankLineWithMatch`
  only carries `matchedTransactionId` (a bare UUID), not the matched
  transaction's own date/amount/party, so the matching grid shows a plain
  "Matched" badge + Unmatch button rather than a mini-preview of the
  counterpart row. This is a real, if minor, gap in the API surface as
  delivered (not something I could add without a query-layer change, which
  is out of scope for ux-developer per this task's boundaries) — flagging
  for a possible inc3+ follow-up if treasurers want to double-check a match
  without unmatching first.
- **Status filter tabs on the list page** (All/Open/Closed via `?status=`)
  were not explicitly named in the Component Plan's bullet for
  `reconciliation-session-list.tsx`, but the GET route already supports a
  `status` query param and the donors page's existing tab convention made
  this a low-cost, consistent addition. Not a scope-creep concern since it's
  pure client-side-navigable filtering over an already-built endpoint
  parameter.
- Everything else (file list, component boundaries, gating, deposit-slip
  rule, hard tie-out disable logic, out-of-period visual separation, date/
  money formatting conventions) follows the design doc verbatim.

### Open questions / handoff notes

- **Next: qa (Phase 5).** This is the biggest UI increment of the feature
  and needs a thorough click-through. Suggested flow, in order:
  1. `/admin/ledger/reconciliation` — confirm status tabs, empty state
     copy ("No reconciliation sessions yet for this account — start one."),
     and that the "New session" account picker never lists a `cash`-type
     account (Petty Cash).
  2. Create a session for a real checking account with a plausible opening/
     closing balance pair; confirm redirect into
     `/admin/ledger/reconciliation/[sessionId]`.
  3. Create a second session with a period that overlaps the first — confirm
     the 409 message names the conflicting period and the dialog stays open
     with the entered values intact.
  4. Upload a **real Chase activity-export CSV** — carried forward from both
     prior increments as an unresolved risk: this design's header/parsing
     assumptions were never verified against an actual export. qa needs a
     real sample file; if none is available, I built a synthetic fixture
     mirroring the exact expected header for qa's convenience:
     `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/30f48b5d-6e02-4de2-a4c4-e8a86d31f4ac/scratchpad/chase-sample.csv`
     (6 columns: `Posting Date,Description,Amount,Type,Balance,Check or Slip #`;
     includes a debit row with a check number, a credit row with `"DEP"` in
     the slip column, a credit with a blank slip column, and one row dated
     outside a narrow test period to exercise the out-of-period path) — this
     is **not** a substitute for a real export and qa should still try to
     obtain one from the treasurer.
  5. In the matching grid: try Match (search by amount, by party, by check
     number), Create transaction (verify a debit line pre-fills Check #,
     a credit line does not and shows the explanatory note, and that
     income requires Payer), and Unmatch (confirm the `ConfirmDialog`
     copy and that the line returns to Unmatched).
  6. Watch the tie-out delta update live (via `router.refresh()`) after each
     match/create/unmatch; confirm Close stays disabled until delta is $0.00
     AND every in-period line is matched (test both conditions independently
     — e.g. a balanced-by-coincidence sum with one line still unmatched must
     still block Close, per the design's explicit anti-loophole check).
  7. Close a balanced session; confirm the reconciled transactions no longer
     appear as match candidates elsewhere, and that the legacy per-row
     reconcile toggle (`/admin/ledger/[fundSlug]`) is now blocked on those
     rows with the "cleared by a closed reconciliation session" 403 message
     (Increment B's immutability guard).
  8. Reopen (as a `LEDGER_MANAGE` user) — confirm the `ConfirmDialog` copy,
     that reverted rows go back to unreconciled, and that reopening while a
     later-period session is already closed on the same account correctly
     409s with the named blocking session.
  9. Test at 360px width: header/tie-out grid stays legible, matching grid
     tables scroll horizontally (`overflow-x-auto`) rather than breaking
     layout, dialogs remain usable.
  10. Confirm a `LEDGER_VIEW`-only user (no `LEDGER_RECORD`/`LEDGER_MANAGE`)
      sees the list and detail pages read-only — no "New session" button, no
      upload form, no matching-grid action column, no reopen button — and
      that hitting the mutation routes directly (curl/devtools) still 403s
      (Increment B's server-side gate, already verified in that increment).
- **New copy strings the Lions Club may want to refine:** "New session"
  dialog description ("Pick the account and statement period..."), the
  tie-out summary's balanced/unbalanced sentences, the out-of-period
  section's toggle label and amber explainer, the reopen `ConfirmDialog`
  description, and the create-from-bank-line dialog's credit-line
  explainer note about deposit-slip numbers.
- **UX decisions/tradeoffs to flag for analyst's Phase 6 review:** the three
  "Deviations" above (no ConfirmDialog on Close, `destructive` styling on
  Unmatch's ConfirmDialog, description-as-party pre-fill), plus the decision
  to add status filter tabs beyond the literal Component Plan text.
- **Carried forward, unresolved:** the real-Chase-CSV verification gap
  (now three increments running without one), and the "no richer matched-
  transaction preview" API gap noted above as a possible follow-up.

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete
**Verdict:** PASS

## Summary

All four gates are green: `tsc --noEmit` clean, `pnpm test` 432/432 (the
25-test reconciliation suite matches the Phase 3 design doc's 22 named tests
exactly, plus 3 for `splitCsvLine`), `pnpm build:only` succeeds with both
pages and all 8 new route files in the manifest, and migration `0059` is
idempotent on a second run (zero errors, only "already exists, skipping"
NOTICEs). A source-level audit of all 8 new routes plus the 2 modified
existing routes confirms every gate matches the design doc exactly, with
`db.transaction()` used correctly for close/reopen/create-from-bank-line. A
live dev-server click-through (15 sequential Playwright scenarios) drove the
full workbench loop against the synthetic fixture end-to-end — session
creation, cash-account exclusion, period-overlap block, corrupted-header
rejection, upload with correct in/out-of-period staging, re-upload
idempotency, match-to-existing via the picker, create-from-bank-line with the
deposit-slip checkNumber rule, live tie-out delta, a **direct-curl proof**
that the close gate is enforced server-side (not just a disabled button),
close, the edit-lock 403 on cleared rows, reopen-ordering (409 blocked by a
later closed session), and reopen itself — all passed. **Mid-run scope
addition:** the orchestrator supplied two real Chase exports; I ran one
(Chase2000, February 2026, 129 rows) through the actual upload route
end-to-end (not just the pure parser) via an authenticated API script,
deriving opening/closing balances from the file's own running-balance
column, and it parsed and staged with zero errors, correct in/out-of-period
counts, and correct dedupe-on-reupload idempotency. One real finding, not a
defect: the mobile-360px check's first-pass metric
(`document.documentElement.scrollWidth`) produced a false positive on both
pages; the correct signal (`document.body.scrollWidth`) and a screenshot
both confirm no actual horizontal overflow. All test data (3 sessions, 6
bank lines, 5 matches, 5 test transactions, 1 seed transaction) was created
and then fully deleted; final counts verified at zero and the account's 104
pre-existing real transactions are untouched (all still `reconciled=true`,
no stray `reconciledSessionId` pointers).

## What I did

Read this file in full (Phase 3 design doc's API Contract, Data Model,
Component Plan, Named Unit Tests, Edge Cases) and all three Phase 4
increment sections (A: database-admin's schema/migration/parser; B:
api-developer's 8 routes + 2 edits; C: ux-developer's pages/components),
plus the parent work-log's Phase 1 five-pass review and both User-decisions
blocks (hard-block tie-out; historical periods supported). Read the
synthetic fixture (`chase-sample.csv`, 6 rows, period 2026-06-01..30, opening
$5,000.00 → closing $5,325.50) and confirmed its arithmetic by hand (5
in-period rows sum to +$325.50; the 6th row is dated 07/02/2026, outside the
period).

**Gates.** Ran `pnpm exec tsc --noEmit` (clean). Ran `pnpm test` (432/432;
read `src/lib/reconciliation.test.ts` in full and matched all 25 tests — the
22 named in the Phase 3 design doc plus 3 for `splitCsvLine` — against the
design's own numbered list, 1:1, no gaps). Ran `pnpm build:only` (succeeded;
grepped the manifest and confirmed both pages
(`/admin/ledger/reconciliation`, `/admin/ledger/reconciliation/[sessionId]`)
and all 8 new API route files present — noting the task brief said "9
routes," but Increments A/B/C's own accounting and the build manifest all
independently agree on 8 route files; flagging as a harmless count
discrepancy in the brief, not a missing route). Ran
`pnpm db:migrate` against `.env.local` twice in a row: first run applied
cleanly, second run produced only "already exists, skipping" NOTICEs for
every object `0059` creates (3 tables, 5 indexes, 3 named constraints, 1
column) — zero errors, idempotency confirmed.

**Route-level audit (source read, not inferred from tests).** Read all 8
files under `src/app/api/admin/ledger/reconciliation/sessions/` plus the 2
modified existing routes
(`transactions/[id]/reconcile/route.ts`, `transactions/[id]/route.ts`) in
full. Every route calls `auth()` first (401 if absent) then `hasFeature()`
(403) before touching data — see the Feature-Gate Audit table below for the
exact key per route. Confirmed `db.transaction()` wraps close (bulk
reconcile-flip + session status), reopen (bulk revert-by-provenance-pointer
+ session status), and create-from-bank-line (insert transaction + insert
match) — matching the design doc's atomicity requirement. Confirmed the
`/match` route's `23505`-to-409 unwrapping mirrors `filings/route.ts`'s
existing pattern (a deliberate, disclosed deviation from Increment B, not a
bug). Confirmed the reconcile-toggle's every write now also sets
`reconciledSessionId: null` (both directions), and the PATCH/DELETE routes'
full-lock guard fires on `existing.reconciledSessionId` — including the
transfer-pair partner-row check in both handlers — exactly as designed.

**Live click-through.** Started `pnpm dev` (port 3000, exclusive). Read all
8 new/changed components and both pages in full to get exact selectors
before writing anything (avoiding blind selector-guessing against a UI this
complex). Wrote a 15-scenario Playwright spec (temporarily placed at
`e2e/tmp-qa-reconciliation.spec.ts`, run via
`npx dotenv -e .env.local -- npx playwright test e2e/tmp-qa-reconciliation.spec.ts`,
then deleted — not a permanent addition, since the Phase 3 design doc named
no e2e tests for this increment) driving `signInAsAdmin` against
Administrative Checking. All 15 scenarios passed on the second run (the
first run caught two of my own selector bugs — a regex passed to
`selectOption({label})`, and a strict-mode-ambiguous `getByRole("alert")`
match against Next's route announcer — fixed before the real run; not
product defects). Seeded one posted transaction via a direct authenticated
API call (`$250.00 Zeffy Donations, 2026-06-05, Administrative Checking`)
first, since the account had zero pre-existing unreconciled posted rows to
exercise the match-picker's "match to an existing book row" path — the other
4 in-period lines used create-from-bank-line.

**Real-Chase-file verification (mid-run scope addition).** The orchestrator
supplied two real exports mid-task and reported the pure-parser layer
(`splitCsvLine`/`validateChaseCsvHeader`/`parseChaseCsvRow`) already verified
clean against all 199 real rows across both files — I did not re-verify that
part. My addition was workbench-level: I inspected both files directly (never
copied into the repo — read via `head`/`awk`/`wc -l` only, and via a script
that streamed the file from `~/Downloads` straight into the real upload
route's multipart body). Both real headers have an extra leading `Details`
column (`DSLIP`/`CHECK`/`DEBIT`/`CREDIT`/`DSLIP`) and a stray trailing empty
field per data row that aren't in the Phase 3 design's assumed 6-column
shape — `validateChaseCsvHeader()`'s name-keyed `indexOf` lookup tolerates
both gracefully (extra columns before/after the 6 required ones don't shift
their indices), which the live upload confirmed. Picked Chase2000
(`Chase2000_Activity_20260721.CSV`, 129 data rows) and February 2026 (10
rows in-period) — derived opening ($25,535.10) and closing ($19,171.80)
balances from the file's own running-`Balance` column (the last Jan-2026 row
and the last Feb-2026 row, since the file is newest-first), and confirmed by
hand that opening + sum(Feb rows) = closing exactly, which also cross-checked
that I'd identified the correct boundary rows. Ran a Node script
(`real-chase-verify.mjs`) that signs in via the real credentials callback,
creates a session (Administrative Checking, 2026-02-01..28), uploads the
real file, and inspects the response + session detail:

- Upload succeeded 201, zero parse errors, `rowCount: 129`,
  `outOfPeriodCount: 119` (129 − 10 in-period, matches my hand count exactly).
- Session detail confirms exactly 10 `inStatementPeriod: true` bank lines;
  9 of the 10 carry a `checkOrSlipNumber` (the 10th is an ACH debit to
  Western Surety with no check number — correctly `null`, not `""`).
- Re-uploading the same file to the same session returned 409 "This session
  already has an uploaded statement" — the session-level one-shot gate
  (the design's primary duplicate-upload defense) fired correctly; I did not
  need to reach the row-level dedupe-key path to prove idempotency, since
  the one-shot gate is the documented first line of defense.
- Deleted this session immediately afterward (cascaded 129 bank lines to 0)
  before starting the synthetic-fixture click-through, so the two test runs
  never had overlapping periods on the same account to worry about.

I did not match or close against this real session's data, per the scope
addition's explicit instruction — parse/stage-and-verify only, then
delete.

**Cleanup.** Deleted, in order: the real-file session (via SQL, cascade to
its 129 bank lines); the 5 test transactions created during the synthetic
click-through (1 API-seeded match candidate + 4 create-from-bank-line
outputs); the 3 synthetic-fixture sessions (June 2026 workbench session, the
Aug-2026 throwaway used for the direct-curl unbalanced-close proof, and the
Sep-2026 later-session used for the reopen-ordering proof) — cascading their
bank lines and matches. Verified via `psql` afterward:
`ledger_reconciliation_sessions`, `ledger_bank_lines`, and
`ledger_reconciliation_matches` all count 0; no transaction anywhere in the
database still has `party`/`memo` containing "QA"; Administrative Checking's
104 pre-existing real (Quicken-imported) transactions are unchanged — all
still `reconciled = true`, none carrying a stray `reconciledSessionId`.
Removed the two temporary spec files from `e2e/` (`git status` confirms
neither is tracked or lingering). Killed the dev server
(confirmed port 3000 free via `lsof`). `git status` at the end shows only
the files Increments A/B/C themselves touched, plus unrelated concurrent
work from other agents (`docs/backlog.md`, `docs/decisions.md`, three
unrelated work-log files) that Increment C had already flagged as
not-mine — I touched no repo source file during this verification pass.

## Outputs

### Type Check
`pnpm exec tsc --noEmit`: **PASS** — clean.

### Unit Tests
`pnpm test`: **PASS**
Total: 432 | Passed: 432 | Failed: 0
Duration: ~0.3s
All 25 tests in `src/lib/reconciliation.test.ts` matched 1:1 against the
Phase 3 design doc's 22 named tests (5 header validation, 5 row parsing, 2
dedupe key, 3 tie-out arithmetic, 4 period-overlap, 3 period-gap) plus 3
tests for `splitCsvLine` (not separately named in the design doc, but needed
by the parser and reasonably added by Increment A). No gaps, no
renamed/dropped tests.

### Production Build
`pnpm build:only`: **PASS**
Both pages (`/admin/ledger/reconciliation`,
`/admin/ledger/reconciliation/[sessionId]`) and all 8 new API route files
present in the manifest. Note: the task brief anticipated "9 routes" — the
design doc, Increment B, Increment C, and the build manifest all
independently and consistently show **8** route files under
`sessions/`. Treating this as a miscount in the brief, not a missing route
— every route named in the Phase 3 API Contract is present and gated.

### Migration Idempotency
`pnpm db:migrate` (0059_ledger_reconciliation_sessions.sql), run twice:
first run clean, second run zero errors (only "already exists, skipping"
NOTICEs for all 3 tables, 5 indexes, 3 named constraints, and the
`reconciled_session_id` column + its index). **PASS.**

### End-to-End Tests
No permanent Playwright spec exists for this feature (none was named in the
Phase 3 design doc's Named Unit Tests, and none was added by Increments A-C).
I drove a 15-scenario temporary Playwright spec against the live dev server
covering the full workbench loop (see click-through table below); it is not
part of the permanent suite (`pnpm test:e2e` numbers are unchanged by this
work). All 15 scenarios passed.

### Manual / Scripted Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| List page: heading, New session button, Petty Cash excluded from account picker | pass | Picker text confirmed to contain "Administrative Checking" and NOT "Petty Cash" |
| Create session (Administrative Checking, June 2026, $5,000.00 → $5,325.50) | pass | Redirected to `/admin/ledger/reconciliation/[sessionId]` |
| Overlapping period (Jun 15 – Jul 15) blocked | pass | Dialog stayed open, entered values preserved, no navigation — 409 surfaced via toast |
| Corrupted-header upload (missing Posting Date) | pass | Named error "This file doesn't look like a Chase activity export — missing a Posting Date column" rendered verbatim in the upload component's `role=alert` |
| Upload synthetic fixture | pass | 5 in-period rows rendered directly; "Show 1 row outside this statement period" toggle present for the 07/02 row |
| Re-upload same file | pass | Upload input no longer rendered at all once `uploadedAt` is set (one-shot gate) |
| Match to an existing transaction (Zeffy $250, via seeded candidate + match picker search) | pass | Search-by-text found exactly 1 candidate; match succeeded |
| Create-from-bank-line, debit line (CHECK PAID #1042) | pass | Check # pre-filled "1042" |
| Create-from-bank-line, credit line (DEPOSIT, slip "DEP") | pass | Check # field empty; explanatory "deposit slip number, not a check number" note shown |
| Create-from-bank-line, remaining 2 in-period lines (fee, CHECK #1043) | pass | Both created and auto-matched |
| Tie-out reaches balanced; Close enabled | pass | "Balanced." text shown; all 5 in-period rows show "Matched"; Close button enabled |
| **Direct-curl proof**: POST close on a fresh, deliberately UNBALANCED session | pass | 400 `{"error":"Does not balance","deltaCents":899999,...}` — proves the gate is server-enforced, not merely a disabled button |
| Close the balanced session | pass | "Session closed — 5 transactions reconciled." toast; page reloads to "Closed" badge |
| Edit-lock: PATCH and DELETE on a cleared transaction | pass | Both return 403 with the "cleared by a closed reconciliation session" message |
| Reopen-ordering: later (Sep 2026) session closed, then reopening the earlier (June) session | pass | 409 with `blockingSessionId` matching the later session; reopening the later session first, then the earlier one, both succeeded |
| Reopen the June session | pass | "Session reopened — N transactions unreconciled." toast |
| Mobile 360px, list + detail pages | pass (after correcting my own check) | `document.body.scrollWidth === document.documentElement.clientWidth === 360` on both pages; a screenshot confirms no visible horizontal overflow. My first-pass metric (`document.documentElement.scrollWidth`, which read 914) was a false positive — not the right DOM node to check for actual page-level overflow. |
| Uncashed-checks panel reflects cleared checks | pass (by mechanism, not a separate live screenshot) | The panel's query (`ledger-queries.ts` `uncashedRows`) filters `eq(ledgerTransactions.reconciled, false)` — the exact same column I directly verified via `psql` flips to `true` on close and back to `false` on reopen. Since there is no separate "session-cleared" status (architect's Ruling 3, verified in the route-level audit), the panel's existing query has nothing new to special-case; it will correctly stop/resume showing a check the moment `reconciled` flips, which I've already proven happens correctly. |
| Real Chase file (Chase2000, Feb 2026, 129 rows) through the real upload route | pass | 201, 129 rows staged, 10 in-period / 119 out-of-period (matches hand-derived count), 9/10 in-period rows carry a check number, re-upload → 409 (idempotent) |

### Regression Tests Added
None — this is new-feature verification, not a bug fix. All 25 unit tests
in `src/lib/reconciliation.test.ts` are Increment A's, not mine; I audited
them against the design doc rather than authoring new ones, per this
feature's Phase 4 gate ("every unit test named in the Phase 3 design doc is
written and passing — the implementer delivers these, not qa").

### Coverage on Critical Modules
- `src/lib/reconciliation.ts`: not separately measured with `--coverage`
  this pass (all 7 exported functions have direct, named-test coverage per
  the audit above — `splitCsvLine`, `validateChaseCsvHeader`,
  `parseChaseCsvRow`, `bankLineDedupeKey`, `computeTieOut`,
  `validatePeriodOverlap`, `computePeriodGapWarning` — every branch named in
  the Phase 3 design doc has a corresponding test). A numeric coverage run
  across the standing targets (`events.ts`, `permissions.ts`, `members.ts`)
  was not part of this feature-specific pass — that's the 7-day
  test-coverage review's job, next due per `docs/reviews/log.md`.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/ledger/reconciliation/sessions` | yes | yes | `FEATURES.LEDGER_VIEW` (read) |
| `POST /api/admin/ledger/reconciliation/sessions` | yes | yes | `FEATURES.LEDGER_RECORD` (write) |
| `GET /api/admin/ledger/reconciliation/sessions/[sessionId]` | yes | yes | `FEATURES.LEDGER_VIEW` (read) |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/upload` | yes | yes | `FEATURES.LEDGER_RECORD` (write) |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match` | yes | yes | `FEATURES.LEDGER_RECORD` (write) |
| `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]` | yes | yes | `FEATURES.LEDGER_RECORD` (write) |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/create-from-bank-line` | yes | yes | `FEATURES.LEDGER_RECORD` (write) |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close` | yes | yes | `FEATURES.LEDGER_RECORD` (write — closing is recording, per the architect's Phase 2 ruling) |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/reopen` | yes | yes | **`FEATURES.LEDGER_MANAGE`** (correctly stricter than close — reopening a settled audit record, per the design's explicit rationale) |
| `POST /api/admin/ledger/transactions/[id]/reconcile` (modified) | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged gate; new behavior is the `reconciledSessionId: null` provenance-clear on every write, confirmed present in both directions |
| `PATCH /api/admin/ledger/transactions/[id]` (modified) | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged gate; new full-lock guard on `reconciledSessionId` confirmed present, including the transfer-pair partner check |
| `DELETE /api/admin/ledger/transactions/[id]` (modified) | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged gate; same full-lock guard confirmed present, including the transfer-pair variant |

Every read-only endpoint takes `LEDGER_VIEW`; every mutation takes
`LEDGER_RECORD` except reopen, which correctly takes the stricter
`LEDGER_MANAGE` — matching the design doc's rationale that reopening a
closed (settled, audit-trail) session is a correction action, not routine
recording. No route returns bulk PII beyond what `LEDGER_VIEW` already
gates elsewhere in this codebase (bank lines and transaction rows, not
member-identifying data).

### Increment C Deviations — positioned for analyst's Phase 6 review

1. **No `<ConfirmDialog>` on Close.** I agree with Increment C's reasoning:
   Close is the forward, expected, fully-reversible (via Reopen)
   end-state of a balanced session, and the hard tie-out gate is a far
   stronger guard against an accidental close than a confirm dialog would
   be. Recommend accepting as-is.
2. **`destructive` styling on Unmatch's `<ConfirmDialog>`.** Unmatch is
   fully reversible and low-stakes; the red/destructive button styling
   slightly overstates the action's severity. A cosmetic nit, not a
   functional issue — recommend softening to a non-destructive style in a
   follow-up, not blocking.
3. **Party pre-fill from bank-line `description` in create-from-bank-line.**
   Reasonable reading of an ambiguous design-doc instruction (bank lines
   have no separate "party" field); the field is editable, so a treasurer
   who wants it blank can clear it in two clicks. Recommend accepting.
4. **Status filter tabs (All/Open/Closed) added beyond the literal
   Component Plan text.** Low-cost, consistent with the donors page's
   existing convention, exercises a query param the GET route already
   supported. Recommend accepting.
5. **No richer "matched to" preview on a matched bank line** (bare
   "Matched" badge, no counterpart date/amount/party). This is a real,
   if minor, API-shape gap (`BankLineWithMatch` only carries
   `matchedTransactionId`) rather than a UI choice — agrees with
   Increment C's own flag. Recommend logging as a named inc3+ follow-up
   rather than blocking this increment; a treasurer can still `Unmatch`
   and re-`Match` to inspect a counterpart if genuinely unsure.

None of the five rise to a functional defect; all five are legitimate calls
for analyst to weigh, not qa findings that block PASS.

### Note for the record — real-file verification split

Per the mid-run scope addition: **parsing-level** verification against real
Chase data is done by the orchestrator (all 199 rows across both real
exports parse cleanly through the pure functions with zero failures).
**Workbench-level** verification (the real upload route, real header with
its extra `Details` column and trailing empty field, real staging counts,
real dedupe-on-reupload) is done by me, against one of the two files
(Chase2000, February 2026). I did not run the second file
(`Chase8338_Activity_20260721.CSV`) through the workbench — the orchestrator's
instruction was to pick either file, and Chase2000 was sufficient to prove
the same header/parsing code path handles a real, messier-than-assumed
export correctly. Neither file was copied into the repo at any point (read
directly from `~/Downloads`, referenced only by absolute path in scratchpad
scripts, never committed).

### Verdict: PASS

Every gate is green, every route is correctly gated, the hard tie-out and
reopen-ordering rules are proven server-side (not just client-side), the
edit-lock is proven, cleanup is proven back to zero, and both the synthetic
fixture and one real Chase export parse and stage correctly end-to-end. The
one thing I initially flagged as a problem (mobile 360px overflow) turned
out to be a flaw in my own check, not the product — corrected and
re-verified before writing this section.

### Open questions / handoff notes

- **Next: analyst for Phase 6** (shipped-vs-intent). Please weigh the five
  Increment C deviations above against the Phase 1 intent, and confirm the
  real-Chase-file verification split (orchestrator: parsing; qa: workbench)
  satisfies the "real Chase CSV export needed for qa's Phase 5" note carried
  forward by all three Phase 4 increments.
- **inc3 (`2026-07-21-ledger-auto-match`)** can proceed once analyst issues
  SHIP IT — nothing found here blocks it. The real Chase file's extra
  `Details`/trailing-empty-field columns are already handled gracefully by
  the current header-lookup approach; inc3's implementer doesn't need to
  revisit `validateChaseCsvHeader()`.
- **Second real file untested at the workbench level**
  (`Chase8338_Activity_20260721.CSV`) — parsing-only (orchestrator-verified).
  If the treasurer's actual first live reconciliation uses the Foundation
  Checking account (which Chase8338 likely corresponds to, though
  `ledger_bank_accounts.last4` is empty for both accounts and I could not
  confirm the account↔file mapping from the data alone), worth a quick
  informal re-check at that time — not a blocking gap, since the same code
  path was already proven against Chase2000.
- **7-day test-coverage review** — check `docs/reviews/log.md` for whether
  it's due; this feature-specific pass does not substitute for that
  periodic sweep.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** SHIP WITH NOTES

## Summary

Every treasurer verb from Phase 1's five-pass review and both Phase 1
User-decisions blocks shipped as designed: hard tie-out with no override,
historical periods supported, session-close writing the same
`reconciled`/`reconciledAt` columns the legacy toggle writes (provenance
pointer only), reopen gated `LEDGER_MANAGE` with surgical revert-by-session,
parse-and-discard, Petty Cash excluded from the account picker, and both
auto-match and Zeffy batch matching cleanly deferred to inc3 with nothing
half-built in the UI or API. I live-verified both of the user's mid-inc2
expectations myself rather than taking QA's code-read as sufficient for the
one that needed a live drive: the no-file-retention framing (data-model +
filesystem check) and, the one QA flagged as unresolved, the cross-session
double-match rejection (created session A, matched and closed a test
transaction, created session B on the next period, and attempted to match a
brand-new bank line in B against A's already-reconciled transaction — got a
clean `409 { error: "This transaction is already reconciled" }`, confirmed
via `psql` that exactly one match row exists for that transaction, and
cleaned up both sessions and the test transaction back to a zero baseline).
Five minor deviations remain from Increment C/qa's Phase 6 handoff — all
cosmetic or narrow API-shape gaps, none functional defects — which I'm
accepting with two tracked backlog follow-ups (B-05, B-06) rather than
blocking. This ships.

## What I did

Re-read my own Phase 1 five-pass review and both User-decisions blocks in the
parent work-log (`2026-07-21-bank-reconciliation.md`), including the
"User expectations confirmed mid-inc2" section added during Phase 5. Read
this file's Phase 3 design doc (API Contract, Data Model, Component/Page
Plan, Edge Cases, Named Unit Tests) and all three Phase 4 increment sections
(database-admin's schema/parser, api-developer's 8 routes + 2 edits,
ux-developer's pages/components) plus qa's full Phase 5 section (gates,
route-level audit, 15-scenario click-through, the real-Chase-file split, the
Feature-Gate Audit table, and the five Increment C deviations qa positioned
for my review).

**Live verification #1 — no statement-file retention.** Walked the data
model: `ledgerReconciliationSessions.csvFilename` is a display-only string
column; the three new tables carry only derived bank-line rows, never file
bytes. Read the upload route
(`src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/upload/route.ts`)
and confirmed there is no `fs.writeFile`, no Blob/`ReceiptStorage` call
anywhere in it — grepped for all three and got zero hits, only a doc comment
citing the architect's parse-and-discard ruling. Checked `.receipt-store/` on
disk: only pre-existing `acknowledgments/` and `receipts/` subdirectories
(from the unrelated receipts feature) — no reconciliation-specific folder
exists at all. Then did the one live check the task asked for as part of the
same session I used for verification #2 below: uploaded two CSVs (session A
and session B's) through the real running dev server, and after the test
completed and I deleted both sessions, `find` for CSVs newer than
`package.json` outside `node_modules` turned up nothing — the files I
"uploaded" existed only as in-memory multipart buffers for the life of the
request, exactly as designed. Confirms the framing: the treasurer can delete
source CSVs immediately after upload; the DB is the durable record.

**Live verification #2 — cross-session double-match rejection.** This is the
one qa explicitly did not drive (proved the `transactionId` unique
constraint by source-code read only — 23505→409 — not by exercising the
cross-session case end-to-end). I own port 3000 with no other implementer
running, so I started `pnpm dev`, confirmed a clean baseline
(`ledger_reconciliation_sessions`/`ledger_bank_lines`/
`ledger_reconciliation_matches` all count 0 via `psql`), and wrote a
temporary Playwright spec (`e2e/tmp-analyst-cross-session.spec.ts`, deleted
after the run, not part of the permanent suite) that, via
`signInAsAdmin()` and real HTTP calls against the live routes:

1. Seeded a posted, unreconciled test transaction on Administrative Checking
   ($123.45, income, party `QA-CROSS-SESSION-TEST`).
2. Created session A (April 2026, opening $0.00 → closing $123.45).
3. Uploaded a one-row CSV matching that transaction's date/amount, matched
   the bank line to the transaction (`201`), and closed session A — the hard
   tie-out balanced exactly ($0 + $123.45 = $123.45), and close returned
   `{ status: "closed", clearedCount: 1 }`.
4. Created session B on the **next** period (May 2026, non-overlapping) —
   the over-wide-extract scenario the user described: a treasurer's export
   often reaches back further than the current period and can include rows
   that duplicate or echo prior months.
5. Uploaded a two-row CSV to session B (one row re-stating the April
   transaction's date/amount/description as an over-wide extract would, one
   real May in-period fee row).
6. **The key call:** `POST /api/admin/ledger/reconciliation/sessions/{B}/match`
   with `{ bankLineId: <B's own in-period bank line>, transactionId: <A's
   now-reconciled transaction> }` — attempting to match a *different*
   session's bank line against a transaction that's already been cleared and
   closed by session A.

Result: **`409 { error: "This transaction is already reconciled" }`** — a
clean, human-readable rejection, not a crash, not a silent duplicate. This is
the app-level `txn.reconciled` check in `match/route.ts` firing before the
request ever reaches the DB unique-constraint layer qa audited — both layers
of defense are real, and I exercised the one qa hadn't. Confirmed via `psql`
immediately after: exactly one row in `ledger_reconciliation_matches` for
that `transaction_id` (the original session-A match; no second row was
created), and `ledger_transactions.reconciled_session_id` still points only
at session A. Cleaned up: deleted both test sessions (cascading their bank
lines/matches) and the seeded test transaction; re-ran the three count
queries — all back to 0; `git status` showed no stray file (the temp spec
was removed, `e2e/` untouched); killed the dev server and confirmed port
3000 free via `lsof`.

**Deviation review.** Read qa's five Increment C deviations (no
`<ConfirmDialog>` on Close; `destructive` styling on Unmatch's confirm;
description-as-party pre-fill; status filter tabs added beyond the literal
Component Plan text; no richer matched-transaction preview) and ruled on each
below. Logged two backlog follow-ups: `docs/backlog.md` B-05 (no
matched-transaction preview + soften Unmatch's destructive styling) and B-06
(no repair path for a mis-uploaded session CSV — carried forward from the
Phase 3 design doc's own "Out of Scope" note, not previously tracked in
`backlog.md`).

## Intent-vs-shipped diff

- **Hard tie-out, no override (User Decision #1).** Phase 1 said: session
  closes only when opening + cleared activity = closing balance exactly,
  enforced server-side. Shipped: `close/route.ts` computes `computeTieOut()`
  and returns 400 with the delta on any non-zero mismatch, plus the
  independent "every in-period line must be matched" check that closes the
  sum-coincidence loophole Phase 3 named. Proven server-side via qa's direct
  curl (not just a disabled button) and live in my own session-A close.
  **Matches.**
- **Historical periods supported (User Decision #2).** Phase 1 said: sessions
  can be created for any past statement period, oldest-first, contiguity is
  a warning not a block. Shipped: `validatePeriodOverlap()` hard-blocks
  overlap (409) while `computePeriodGapWarning()` is a non-blocking notice —
  exactly the split the decision required. I created session A (April) and
  session B (May) with no forced ordering constraint beyond non-overlap.
  **Matches.**
- **Session-clear writes the same `reconciled`/`reconciledAt` columns (Phase
  2 Ruling 3).** Shipped exactly: `reconciledSessionId` is a bare provenance
  pointer, not a parallel status; the legacy per-row toggle clears it on
  every write; qa verified the uncashed-checks panel needs no
  special-casing because there's only one source of truth. **Matches.**
- **Reopen: `LEDGER_MANAGE` + surgical revert (Flow F).** Shipped: reopen
  reverts only rows where `reconciledSessionId` equals the closing session
  (not a timestamp heuristic), is gated stricter than close, wraps
  `<ConfirmDialog destructive>`, and adds the reopen-ordering rule (can't
  reopen an earlier session while a later one is closed) that Phase 1 didn't
  ask for but the architect and tech-lead correctly identified as necessary
  bank-rec discipline. **Matches, with a reasoned addition.**
- **Parse-and-discard (Gaps list, architect Section 4 ruling).** Shipped and
  live-verified by me above: no file persistence anywhere, DB carries only
  derived bank-line rows. **Matches.**
- **Petty Cash excluded (Pass 4 edge case / T-20).** Shipped as a query
  filter (`accountType !== 'cash'`), re-enforced server-side at session
  creation (400 if bypassed client-side) — qa's click-through confirmed
  Petty Cash never appears in the picker. **Matches.**
- **Zeffy batch matching: explicitly deferred to inc3.** Confirmed nothing
  half-shipped: no Zeffy-specific UI affordance, no batch-sum validation
  code path, no partial schema for it beyond the deliberately-non-unique
  `bankLineId` on the matches table (a forward-compatible shape choice, not
  a half-built feature). The matching grid and match picker treat every bank
  line/transaction pair as an ordinary 1:1 manual match — there is no
  "Zeffy" special case anywhere in Increment C's components. **Matches —
  clean deferral, confirmed by inspection.**
- **Auto-match: explicitly deferred to inc3; manual flow stands alone as
  usable.** Confirmed: the match picker is a plain searchable list (by
  amount/date/party/memo/check#) with no suggestion/scoring/ambiguity UI —
  exactly the "human is the entire matching engine" design. I exercised the
  full manual loop live (create → upload → match → close) end-to-end in
  under two minutes of API calls; it is a complete, usable workflow without
  inc3. **Matches — the manual flow is real and sufficient on its own, not a
  stub waiting for automation.**
- **No statement-file retention (mid-inc2 user expectation #1).** Live-verified
  above. **Matches.**
- **Over-wide extracts / cross-session double-match rejection (mid-inc2 user
  expectation #2).** Live-verified above (qa had only code-read this).
  **Matches.**

## Edge cases

- **Empty states** — pass. List page: "No reconciliation sessions yet for
  this account — start one" (qa click-through confirmed verbatim). Zero-row
  CSV / all-out-of-period upload: `outOfPeriodCount` reported explicitly in
  the success toast, never a silently-empty grid that looks broken.
- **Failure microcopy** — pass. Header-validation error names the specific
  missing column verbatim (qa's click-through confirmed the exact string
  from Phase 1's Flow A example rendered in the UI, not just the API).
  Tie-out delta message names the exact cents mismatch, not "doesn't
  balance." My own live run saw two more: the overlap 409 names the
  conflicting period, and the cross-session double-match 409 names the
  specific reason ("already reconciled") — human sentences throughout, no
  stack traces reached the client in any path I or qa exercised.
- **Permission gates (three tiers)** — pass. `LEDGER_VIEW` read-only (no
  mutation UI, server-side 403 on direct route hits — qa verified);
  `LEDGER_RECORD` for create/upload/match/create-from-bank-line/close;
  `LEDGER_MANAGE` correctly stricter for reopen. Every route in qa's
  Feature-Gate Audit table shows `auth()` then `hasFeature()` before any DB
  touch. A user with no `LEDGER_*` feature at all still lands on
  `/access-pending` per the codebase's standard pattern (not re-tested here
  — no new gating mechanism was introduced, so this is inherited, not
  feature-specific risk).
- **Mobile 360px** — pass, per qa's corrected finding (their first-pass
  `scrollWidth` metric was a false positive on the wrong DOM node; the
  corrected check plus a screenshot showed no actual overflow on either
  page). Not independently re-shot by me — qa's correction is well-reasoned
  and I have no reason to doubt it.
- **Brand consistency** — pass. Cards `rounded-2xl` (session list,
  matching grid), buttons `rounded-lg`, `<ConfirmDialog>` used for Reopen and
  Unmatch (no native dialogs anywhere — confirmed via qa's
  `console.log`/`window.confirm` grep, zero hits). One judgment call
  (Unmatch's `destructive` styling) flagged below, not a brand violation —
  `<ConfirmDialog destructive>` is still the correct component, just an
  arguably-too-strong severity choice.
- **OAuth-vs-password, access-pending mid-onboarding, Google Group sync,
  email queue** — not applicable, as Phase 1 established: this is a
  single-surface `LEDGER_*` admin feature with no member-facing or
  cross-surface touchpoints. Nothing shipped introduces any of these.

## Deviation rulings

1. **No `<ConfirmDialog>` on Close.** Accept. Close is the expected forward
   end-state of a balanced session and is fully reversible via Reopen; the
   hard tie-out gate is a stronger guard against an accidental close than a
   confirm dialog. No follow-up.
2. **`destructive` styling on Unmatch's `<ConfirmDialog>`.** Soften,
   don't block. Cosmetic — logged as part of backlog B-05 for the next
   time this component is touched (naturally bundled with inc3, which
   revisits the matching grid for auto-match anyway).
3. **Party pre-fill from bank-line `description`.** Accept. Reasonable
   reading of an ambiguous instruction, the field is editable in two clicks,
   and an empty-by-default alternative would just move the friction rather
   than remove it. No follow-up.
4. **Status filter tabs (All/Open/Closed) added beyond the literal Component
   Plan text.** Accept. Low-cost, consistent with the donors page's existing
   convention, exercises a query param the route already supported. No
   follow-up.
5. **No richer "matched to" preview on a matched bank line.** Real, if minor,
   gap — agree with both ux-developer's and qa's own read that this is an
   API-shape limitation (`BankLineWithMatch` only carries a bare
   `matchedTransactionId`), not a UI choice. Logged as backlog **B-05**,
   scoped to bundle with inc3 since that increment already touches the same
   query path for auto-match. Not blocking — a treasurer can still Unmatch
   and re-Match to inspect a counterpart today.

Additionally logging backlog **B-06** — the Phase 3 design doc's own
"Out of Scope" note that a mis-uploaded session CSV has no delete/replace
path — since it was flagged in the design doc but never carried into
`docs/backlog.md` where the project's other tracked follow-ups live.

## What the treasurer's first real session should look like

The real-file verification split is: **parsing-level** (orchestrator, both
real Chase exports, 199/199 rows, zero failures) and **workbench-level** (qa,
one file — Chase2000, February 2026, 129 rows, staged through the actual
upload route with correct in/out-of-period counts and correct
dedupe-on-reupload). Neither of us matched or closed against real data —
by design, to avoid touching the club's actual books during verification.
What remains, and is the true acceptance test, is the treasurer running one
complete real month end-to-end:

1. Pick the oldest workable T-13 month (per the "historical periods
   supported" decision, oldest-first) for one account — likely Administrative
   Checking, since that's the account both the synthetic fixture and the
   real-file workbench check exercised.
2. Enter the real statement's opening/closing balance from the actual Chase
   statement (not derived from the CSV's running balance as qa's script did
   for convenience — the treasurer should use the number Chase itself
   reports as the statement's closing balance, to catch any discrepancy
   between "what Chase says the statement closed at" and "what our own
   running balance column shows").
3. Upload the real export for that month.
4. Work every in-period line to a match or a new transaction — this is where
   real friction, if any exists, will show up: ambiguous same-amount
   candidates, a bank fee or interest line needing Create-from-bank-line, or
   a stray prior-month row appearing in the export (all of which the design
   anticipates, none of which has been exercised against this specific
   club's real transaction history at volume).
5. Close it. If the hard tie-out doesn't balance, that's either a genuine
   book error the feature just surfaced (arguably the whole point of T-13)
   or a data-quality issue inc1's backfill review list didn't catch — either
   way, useful signal, not a reason to distrust the feature.
6. If Foundation Checking's first real session ends up using the second real
   file (`Chase8338_Activity_20260721.CSV`, workbench-untested — noted by qa
   as a minor, non-blocking gap), a quick informal re-check that the header
   parses cleanly (it should, since the same header-lookup code path already
   proved itself against Chase2000's messier-than-assumed real header) is
   worth five minutes but shouldn't block starting.

This first real session is the acceptance test the synthetic fixture and the
scripted real-file checks were always standing in for. Nothing in this
review found a reason to expect it to fail; it just hasn't happened yet.

## Outputs

- `docs/work-log/2026-07-21-ledger-reconciliation-sessions.md` — this Phase 6
  section; Per-Phase Status row updated to
  `Complete / SHIP WITH NOTES / 2026-07-21`.
- `docs/backlog.md` — added **B-05** (no matched-transaction preview; soften
  Unmatch's destructive styling) and **B-06** (no repair path for a
  mis-uploaded session CSV).
- No other source files touched. The temporary Playwright spec
  (`e2e/tmp-analyst-cross-session.spec.ts`) used for live verification #2 was
  deleted after the run; `git status` confirms `e2e/` is unchanged from
  before this review. All test data (2 sessions, 1 bank-line-derived match,
  1 seeded transaction across both live-verification runs) was created and
  fully deleted; `ledger_reconciliation_sessions`/`ledger_bank_lines`/
  `ledger_reconciliation_matches` counts confirmed at 0 via `psql` before and
  after. Dev server stopped; port 3000 confirmed free.

## Open questions / handoff notes

- **inc3 (`2026-07-21-ledger-auto-match`) may proceed.** Nothing in this
  review blocks it; B-05's matched-transaction-preview fix is a natural
  bundle with inc3's own query-path changes, not a prerequisite.
- **The parent feature (`2026-07-21-bank-reconciliation.md`) is not closed by
  this verdict** — its own Phase 6 covers all three increments together and
  should wait until inc3 ships. Per this task's scope, the parent work-log
  was read but not edited.
- **The treasurer's first real reconciliation session is the outstanding
  real-world acceptance test** — see the walkthrough above. Nothing here is
  a blocker; it just hasn't happened yet.
- **B-05 and B-06** are now in `docs/backlog.md`, ready to be picked up
  standalone or folded into inc3's scope at tech-lead's discretion.
