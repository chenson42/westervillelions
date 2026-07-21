/**
 * Server-only Bank Reconciliation (inc2) query helpers.
 *
 * Mirrors ledger-queries.ts's role as the authoritative data-access layer —
 * import in Server Components and API route handlers, never in client
 * components. Kept as a SEPARATE file from ledger-queries.ts per the
 * architect's Phase 2 ruling (docs/work-log/2026-07-21-bank-reconciliation.md
 * §4) — reconciliation is a distinct feature surface built on top of the
 * existing ledger_transactions table, not a rework of it.
 *
 * Session CRUD, bank-line insert/list, match insert/delete, the
 * candidate-transaction query, and tie-out assembly for the session detail
 * page all live here. Multi-table ATOMIC writes (session close, reopen,
 * create-transaction-from-bank-line) are NOT implemented in this file —
 * consistent with this codebase's existing convention (see
 * src/app/api/admin/ledger/transactions/[id]/route.ts's inline
 * `db.transaction(async (tx) => { ... })` blocks), those are written directly
 * in the route handlers by api-developer, composing the read helpers below.
 *
 * Key invariants carried over from ledger-queries.ts:
 *   - All parameterized via Drizzle — no string interpolation.
 *   - date columns are 'YYYY-MM-DD' strings in JS, not Date objects.
 *   - No N+1 queries — list/detail queries join in a single pass.
 */

import { db } from "@/lib/db";
import {
  ledgerReconciliationSessions,
  ledgerBankLines,
  ledgerReconciliationMatches,
  ledgerBankAccounts,
  ledgerEntities,
  ledgerTransactions,
  type LedgerReconciliationSession,
  type NewLedgerBankLine,
  type LedgerBankLine,
  type LedgerReconciliationMatch,
} from "@/lib/db/schema";
import { eq, and, isNull, desc, asc } from "drizzle-orm";
import type { ExistingSessionPeriod } from "@/lib/reconciliation";

// ---------------------------------------------------------------------------
// Session list (audit-trail view)
// ---------------------------------------------------------------------------

export type ReconciliationSessionListRow = {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  entitySlug: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  status: string;
  uploadedAt: Date | null;
  csvRowCount: number | null;
  closedAt: Date | null;
};

/**
 * Lists reconciliation sessions, newest statement period first. Optional
 * filters: entityId, bankAccountId, status ('open' | 'closed'). Powers the
 * `/admin/ledger/reconciliation` list page.
 */
export async function getReconciliationSessions(opts?: {
  entityId?: string;
  bankAccountId?: string;
  status?: string;
}): Promise<ReconciliationSessionListRow[]> {
  const conditions = [];
  if (opts?.bankAccountId) {
    conditions.push(eq(ledgerReconciliationSessions.bankAccountId, opts.bankAccountId));
  }
  if (opts?.status) {
    conditions.push(eq(ledgerReconciliationSessions.status, opts.status));
  }
  if (opts?.entityId) {
    conditions.push(eq(ledgerBankAccounts.entityId, opts.entityId));
  }

  const rows = await db
    .select({
      id: ledgerReconciliationSessions.id,
      bankAccountId: ledgerReconciliationSessions.bankAccountId,
      bankAccountName: ledgerBankAccounts.name,
      entitySlug: ledgerEntities.slug,
      statementPeriodStart: ledgerReconciliationSessions.statementPeriodStart,
      statementPeriodEnd: ledgerReconciliationSessions.statementPeriodEnd,
      openingBalanceCents: ledgerReconciliationSessions.openingBalanceCents,
      closingBalanceCents: ledgerReconciliationSessions.closingBalanceCents,
      status: ledgerReconciliationSessions.status,
      uploadedAt: ledgerReconciliationSessions.uploadedAt,
      csvRowCount: ledgerReconciliationSessions.csvRowCount,
      closedAt: ledgerReconciliationSessions.closedAt,
    })
    .from(ledgerReconciliationSessions)
    .innerJoin(
      ledgerBankAccounts,
      eq(ledgerReconciliationSessions.bankAccountId, ledgerBankAccounts.id),
    )
    .innerJoin(ledgerEntities, eq(ledgerBankAccounts.entityId, ledgerEntities.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ledgerReconciliationSessions.statementPeriodEnd));

  return rows;
}

// ---------------------------------------------------------------------------
// Period overlap / gap support
// ---------------------------------------------------------------------------

/**
 * Every existing session (ANY status — open or closed) for a bank account,
 * as `{ id, start, end }` — the exact shape validatePeriodOverlap() and the
 * gap-warning caller need. Ordered by statementPeriodEnd DESC so
 * `result[0]?.end ?? null` is the "most recent prior period end" input to
 * computePeriodGapWarning().
 */
export async function getSessionPeriodsForAccount(
  bankAccountId: string,
): Promise<ExistingSessionPeriod[]> {
  const rows = await db
    .select({
      id: ledgerReconciliationSessions.id,
      start: ledgerReconciliationSessions.statementPeriodStart,
      end: ledgerReconciliationSessions.statementPeriodEnd,
    })
    .from(ledgerReconciliationSessions)
    .where(eq(ledgerReconciliationSessions.bankAccountId, bankAccountId))
    .orderBy(desc(ledgerReconciliationSessions.statementPeriodEnd));

  return rows;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export type CreateReconciliationSessionInput = {
  bankAccountId: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
};

export async function createReconciliationSession(
  input: CreateReconciliationSessionInput,
): Promise<LedgerReconciliationSession> {
  const [row] = await db
    .insert(ledgerReconciliationSessions)
    .values(input)
    .returning();
  return row;
}

export type ReconciliationSessionDetail = LedgerReconciliationSession & {
  bankAccountName: string;
  bankAccountType: string;
  entitySlug: string;
  entityId: string;
};

/** Fetches one session with its bank account/entity context, for the
 *  session detail page and every route that validates against a sessionId. */
export async function getReconciliationSessionById(
  sessionId: string,
): Promise<ReconciliationSessionDetail | null> {
  const rows = await db
    .select({
      session: ledgerReconciliationSessions,
      bankAccountName: ledgerBankAccounts.name,
      bankAccountType: ledgerBankAccounts.accountType,
      entitySlug: ledgerEntities.slug,
      entityId: ledgerEntities.id,
    })
    .from(ledgerReconciliationSessions)
    .innerJoin(
      ledgerBankAccounts,
      eq(ledgerReconciliationSessions.bankAccountId, ledgerBankAccounts.id),
    )
    .innerJoin(ledgerEntities, eq(ledgerBankAccounts.entityId, ledgerEntities.id))
    .where(eq(ledgerReconciliationSessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row.session,
    bankAccountName: row.bankAccountName,
    bankAccountType: row.bankAccountType,
    entitySlug: row.entitySlug,
    entityId: row.entityId,
  };
}

/** Marks a session's CSV upload complete — sets uploadedAt/csvFilename/csvRowCount.
 *  One-shot: callers must first confirm `uploadedAt === null` (the upload
 *  route's idempotency gate), this function does not re-check. */
export async function markSessionUploaded(
  sessionId: string,
  info: { uploadedAt: Date; csvFilename: string; csvRowCount: number },
): Promise<void> {
  await db
    .update(ledgerReconciliationSessions)
    .set({
      uploadedAt: info.uploadedAt,
      csvFilename: info.csvFilename,
      csvRowCount: info.csvRowCount,
      updatedAt: new Date(),
    })
    .where(eq(ledgerReconciliationSessions.id, sessionId));
}

// ---------------------------------------------------------------------------
// Bank lines
// ---------------------------------------------------------------------------

export type NewBankLineRow = Omit<NewLedgerBankLine, "id" | "createdAt">;

/**
 * Bulk-inserts parsed bank lines for a session, `ON CONFLICT (session_id,
 * dedupe_key) DO NOTHING` — defense-in-depth against a literally-duplicated
 * row inside one file (the PRIMARY duplicate-upload defense is the session's
 * one-shot `uploadedAt` gate in the upload route, checked before this is
 * ever called).
 *
 * @returns the number of rows actually inserted (rows silently skipped by
 *          the conflict target are not counted).
 */
export async function insertBankLines(rows: NewBankLineRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const inserted = await db
    .insert(ledgerBankLines)
    .values(rows)
    .onConflictDoNothing({ target: [ledgerBankLines.sessionId, ledgerBankLines.dedupeKey] })
    .returning({ id: ledgerBankLines.id });

  return inserted.length;
}

export type BankLineWithMatch = LedgerBankLine & {
  matchId: string | null;
  matchedTransactionId: string | null;
};

/**
 * All bank lines for a session, each carrying its match state (derived from
 * a LEFT JOIN against ledger_reconciliation_matches — no denormalized status
 * column on ledger_bank_lines, per the "don't fork state" principle).
 * `matchedTransactionId` is null when the line has no match yet.
 *
 * Ordered by postingDate ascending (bank-statement order).
 */
export async function getBankLinesForSession(sessionId: string): Promise<BankLineWithMatch[]> {
  const rows = await db
    .select({
      line: ledgerBankLines,
      matchId: ledgerReconciliationMatches.id,
      matchedTransactionId: ledgerReconciliationMatches.transactionId,
    })
    .from(ledgerBankLines)
    .leftJoin(
      ledgerReconciliationMatches,
      eq(ledgerReconciliationMatches.bankLineId, ledgerBankLines.id),
    )
    .where(eq(ledgerBankLines.sessionId, sessionId))
    .orderBy(asc(ledgerBankLines.postingDate));

  return rows.map((r) => ({
    ...r.line,
    matchId: r.matchId ?? null,
    matchedTransactionId: r.matchedTransactionId ?? null,
  }));
}

export async function getBankLineById(
  sessionId: string,
  bankLineId: string,
): Promise<LedgerBankLine | null> {
  const rows = await db
    .select()
    .from(ledgerBankLines)
    .where(and(eq(ledgerBankLines.id, bankLineId), eq(ledgerBankLines.sessionId, sessionId)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Candidate transactions for matching
// ---------------------------------------------------------------------------

export type CandidateTransactionRow = {
  id: string;
  txnDate: string;
  flow: string;
  amountCents: number;
  party: string | null;
  memo: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
};

/**
 * Candidate posted transactions for manual matching against a bank line:
 * `bankAccountId` matches this session's account, `reconciled = false`, and
 * not already matched in ANY session (LEFT JOIN against
 * ledger_reconciliation_matches, WHERE match row IS NULL).
 *
 * NULL `checkNumber` is an ordinary, expected case here (inc1 Phase 6 note)
 * — never filtered out.
 */
export async function getCandidateTransactionsForMatching(
  bankAccountId: string,
): Promise<CandidateTransactionRow[]> {
  const rows = await db
    .select({
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      memo: ledgerTransactions.memo,
      checkNumber: ledgerTransactions.checkNumber,
      paymentMethod: ledgerTransactions.paymentMethod,
    })
    .from(ledgerTransactions)
    .leftJoin(
      ledgerReconciliationMatches,
      eq(ledgerReconciliationMatches.transactionId, ledgerTransactions.id),
    )
    .where(
      and(
        eq(ledgerTransactions.bankAccountId, bankAccountId),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
        isNull(ledgerReconciliationMatches.id),
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate));

  return rows;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function getMatchForBankLine(
  bankLineId: string,
): Promise<LedgerReconciliationMatch | null> {
  const rows = await db
    .select()
    .from(ledgerReconciliationMatches)
    .where(eq(ledgerReconciliationMatches.bankLineId, bankLineId))
    .limit(1);
  return rows[0] ?? null;
}

/** transactionId is UNIQUE on this table (forever — DECISION-036), so at
 *  most one row can ever match. Used by the /match route to enforce "this
 *  book row hasn't already cleared against a different bank line." */
export async function getMatchForTransaction(
  transactionId: string,
): Promise<LedgerReconciliationMatch | null> {
  const rows = await db
    .select()
    .from(ledgerReconciliationMatches)
    .where(eq(ledgerReconciliationMatches.transactionId, transactionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMatchById(
  sessionId: string,
  matchId: string,
): Promise<LedgerReconciliationMatch | null> {
  const rows = await db
    .select()
    .from(ledgerReconciliationMatches)
    .where(
      and(
        eq(ledgerReconciliationMatches.id, matchId),
        eq(ledgerReconciliationMatches.sessionId, sessionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertMatch(input: {
  sessionId: string;
  bankLineId: string;
  transactionId: string;
  createdByUserId: string;
}): Promise<LedgerReconciliationMatch> {
  const [row] = await db.insert(ledgerReconciliationMatches).values(input).returning();
  return row;
}

export async function deleteMatch(matchId: string): Promise<void> {
  await db.delete(ledgerReconciliationMatches).where(eq(ledgerReconciliationMatches.id, matchId));
}

// ---------------------------------------------------------------------------
// Tie-out assembly (session detail page + close-route gate)
// ---------------------------------------------------------------------------

export type TieOutAssembly = {
  /** Signed amountCents of every MATCHED, in-period bank line — feed directly
   *  into computeTieOut()'s matchedLineAmountsCents. */
  matchedLineAmountsCents: number[];
  /** Every in-period bank line with no match yet — feeds both the close
   *  route's "N bank lines still unmatched" gate and the detail page's
   *  unmatchedInPeriodCount tie-out field. */
  unmatchedInPeriodBankLineIds: string[];
};

/**
 * Assembles the raw counts/sums computeTieOut() needs for a session, in a
 * single pass over the session's bank lines (no N+1): which in-period lines
 * are matched (their signed amounts) vs. unmatched (their ids).
 *
 * Out-of-period lines are excluded entirely from both lists — they're never
 * part of "this session's" close gate or tie-out sum (design doc Edge Cases).
 */
export async function getTieOutAssembly(sessionId: string): Promise<TieOutAssembly> {
  const rows = await db
    .select({
      id: ledgerBankLines.id,
      amountCents: ledgerBankLines.amountCents,
      matchedTransactionId: ledgerReconciliationMatches.transactionId,
    })
    .from(ledgerBankLines)
    .leftJoin(
      ledgerReconciliationMatches,
      eq(ledgerReconciliationMatches.bankLineId, ledgerBankLines.id),
    )
    .where(and(eq(ledgerBankLines.sessionId, sessionId), eq(ledgerBankLines.inStatementPeriod, true)));

  const matchedLineAmountsCents: number[] = [];
  const unmatchedInPeriodBankLineIds: string[] = [];

  for (const row of rows) {
    if (row.matchedTransactionId) {
      matchedLineAmountsCents.push(row.amountCents);
    } else {
      unmatchedInPeriodBankLineIds.push(row.id);
    }
  }

  return { matchedLineAmountsCents, unmatchedInPeriodBankLineIds };
}

/** Every transactionId matched anywhere in this session — feeds the close
 *  route's defensive re-check ("every matched transaction is still posted")
 *  and its bulk `reconciled = true` update. */
export async function getMatchedTransactionIdsForSession(sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ transactionId: ledgerReconciliationMatches.transactionId })
    .from(ledgerReconciliationMatches)
    .where(eq(ledgerReconciliationMatches.sessionId, sessionId));
  return rows.map((r) => r.transactionId);
}

// ---------------------------------------------------------------------------
// Reopen-ordering rule
// ---------------------------------------------------------------------------

export type BlockingSession = {
  id: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
};

/**
 * Finds a CLOSED session on the same bank account with a later statement
 * period end — the reopen route's ordering rule: an earlier period cannot be
 * reopened while a later period is already closed on top of it.
 */
export async function getLaterClosedSessionForAccount(
  bankAccountId: string,
  statementPeriodEnd: string,
): Promise<BlockingSession | null> {
  const rows = await db
    .select({
      id: ledgerReconciliationSessions.id,
      statementPeriodStart: ledgerReconciliationSessions.statementPeriodStart,
      statementPeriodEnd: ledgerReconciliationSessions.statementPeriodEnd,
    })
    .from(ledgerReconciliationSessions)
    .where(
      and(
        eq(ledgerReconciliationSessions.bankAccountId, bankAccountId),
        eq(ledgerReconciliationSessions.status, "closed"),
      ),
    )
    .orderBy(asc(ledgerReconciliationSessions.statementPeriodEnd));

  // Filter in JS (date-string comparison) rather than a Drizzle `gt()` against
  // a `date` column bound — keeps this consistent with the rest of the file's
  // plain-string date handling and avoids a second round trip for the common
  // case (few sessions per account).
  const blocking = rows.find((r) => r.statementPeriodEnd > statementPeriodEnd);
  return blocking ?? null;
}
