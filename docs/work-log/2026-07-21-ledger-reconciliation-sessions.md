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
| 4 — Implementation | database-admin → api-developer → ux-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
