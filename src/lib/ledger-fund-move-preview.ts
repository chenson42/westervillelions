/**
 * Read-only computations behind the move preview (GET) and a few reads the
 * execute path shares (DECISION-113, docs/work-log/2026-10-01-cross-entity-
 * transaction-move.md). Sibling of ./ledger-fund-move-queries.ts, which stays
 * the single evaluator + execute; this module holds the per-account balance
 * impact, the duplicate-candidate query, the closed-session `unlock` block,
 * the sent-statement lookup, the receipt state and the register context.
 *
 * Writes NOTHING, sends nothing. Every function takes `db` or a transaction
 * handle. NEVER import ./ledger-audit or ./ledger-correction audit text here:
 * the member-surface firewall covers those two files, and this module has no
 * reason to read a reason.
 */

import { and, asc, desc, eq, gte, lte, ne, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgerAcknowledgments,
  ledgerBankAccounts,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReconciliationSessions,
  ledgerTransactions,
  financialReportSends,
  type LedgerTransaction,
} from "@/lib/db/schema";
import { fundBalanceCents } from "@/lib/ledger";
import { MEMBER_EXPOSED_FUND_KINDS, monthBounds } from "@/lib/financial-report-queries";
import { listLaterClosedSessionsForAccount } from "@/lib/reconciliation-queries";
import type {
  MoveBankOption,
  MoveDuplicateCandidate,
  MoveUnlock,
} from "@/lib/ledger-correction";

export type SelectExec = Pick<typeof db, "select">;

export const DUPLICATE_WINDOW_DAYS = 30;
export const DUPLICATE_CANDIDATE_CAP = 5;

// ---------------------------------------------------------------------------
// Sent-statement lookup
// ---------------------------------------------------------------------------

/**
 * "YYYY-MM" of the row's month when a SUCCESSFUL statement send exists for the
 * entity and that month AND the fund kind is member-exposed; otherwise null.
 * Read-only: writes nothing, sends nothing. Called once per entity.
 */
export async function findSentStatementMonth(
  exec: SelectExec,
  args: { entityId: string; txnDate: string; fundKind: string },
): Promise<string | null> {
  if (!(MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(args.fundKind)) return null;
  const ym = args.txnDate.slice(0, 7);
  let monthEnd: string;
  try {
    monthEnd = monthBounds(ym).monthEnd;
  } catch {
    return null;
  }
  const rows = await exec
    .select({ id: financialReportSends.id })
    .from(financialReportSends)
    .where(
      and(
        eq(financialReportSends.entityId, args.entityId),
        eq(financialReportSends.monthEnd, monthEnd),
        eq(financialReportSends.success, true),
      ),
    )
    .limit(1);
  return rows[0] ? ym : null;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

type FlowRow = { id: string; flow: string; amountCents: number };

/** Posted rows of a fund, for `fundBalanceCents()`. */
export async function postedFundRows(exec: SelectExec, fundId: string): Promise<FlowRow[]> {
  return exec
    .select({
      id: ledgerTransactions.id,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
    })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.fundId, fundId), eq(ledgerTransactions.status, "posted")));
}

/**
 * All-time book balance of a bank account: its opening balance plus the signed
 * sum of posted rows on it, computed with the canonical `fundBalanceCents()`
 * (no new sign logic).
 */
export async function accountBookBalance(
  exec: SelectExec,
  bankAccountId: string,
  openingBalanceCents: number,
): Promise<{ rows: FlowRow[]; balanceCents: number }> {
  const rows: FlowRow[] = await exec
    .select({
      id: ledgerTransactions.id,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.bankAccountId, bankAccountId),
        eq(ledgerTransactions.status, "posted"),
      ),
    );
  return { rows, balanceCents: fundBalanceCents(openingBalanceCents, rows) };
}

/** The row's current bank account with its book balance before and after the row leaves it. */
export async function sourceBankImpact(
  exec: SelectExec,
  row: Pick<LedgerTransaction, "id" | "bankAccountId">,
): Promise<{ name: string; beforeCents: number; afterCents: number } | null> {
  if (!row.bankAccountId) return null;
  const acct = await exec
    .select({
      name: ledgerBankAccounts.name,
      openingBalanceCents: ledgerBankAccounts.openingBalanceCents,
    })
    .from(ledgerBankAccounts)
    .where(eq(ledgerBankAccounts.id, row.bankAccountId))
    .limit(1);
  if (!acct[0]) return null;
  const { rows, balanceCents } = await accountBookBalance(
    exec,
    row.bankAccountId,
    acct[0].openingBalanceCents,
  );
  return {
    name: acct[0].name,
    beforeCents: balanceCents,
    afterCents: fundBalanceCents(
      acct[0].openingBalanceCents,
      rows.filter((r) => r.id !== row.id),
    ),
  };
}

/**
 * ACTIVE bank accounts of an entity with the book balance before and after an
 * income row of `amountCents` lands there. `defaultBankAccountId` is set ONLY
 * when exactly one active account exists: a wrong guess silently breaks the
 * next reconciliation.
 */
export async function listActiveBankOptions(
  exec: SelectExec,
  entityId: string,
  row: Pick<LedgerTransaction, "flow" | "amountCents">,
): Promise<{ options: MoveBankOption[]; defaultBankAccountId: string | null }> {
  const accounts = await exec
    .select({
      id: ledgerBankAccounts.id,
      name: ledgerBankAccounts.name,
      openingBalanceCents: ledgerBankAccounts.openingBalanceCents,
    })
    .from(ledgerBankAccounts)
    .where(and(eq(ledgerBankAccounts.entityId, entityId), eq(ledgerBankAccounts.isActive, true)))
    .orderBy(asc(ledgerBankAccounts.name));

  const options: MoveBankOption[] = [];
  for (const a of accounts) {
    const { balanceCents } = await accountBookBalance(exec, a.id, a.openingBalanceCents);
    const delta = row.flow === "income" ? row.amountCents : -row.amountCents;
    options.push({ id: a.id, name: a.name, beforeCents: balanceCents, afterCents: balanceCents + delta });
  }
  return { options, defaultBankAccountId: options.length === 1 ? options[0].id : null };
}

// ---------------------------------------------------------------------------
// Duplicate candidates (advisory)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" plus `days` (UTC arithmetic on the calendar date; no timezone drift). */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Posted income rows in the DESTINATION entity (any fund, any account) with the
 * same amount within 30 days of the row's date, excluding the row itself and
 * transfer legs, newest first, capped at 5. ADVISORY only: it cannot see a
 * deposit bundled with other money (B-107). Never blocks a move.
 */
export async function findDuplicateCandidates(
  exec: SelectExec,
  args: { row: Pick<LedgerTransaction, "id" | "txnDate" | "amountCents">; destEntityId: string },
): Promise<MoveDuplicateCandidate[]> {
  const rows = await exec
    .select({
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      party: ledgerTransactions.party,
      amountCents: ledgerTransactions.amountCents,
      reconciled: ledgerTransactions.reconciled,
      reconciledSessionId: ledgerTransactions.reconciledSessionId,
      fundName: ledgerFunds.name,
      bankAccountName: ledgerBankAccounts.name,
      matchId: ledgerReconciliationMatches.id,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerBankAccounts, eq(ledgerTransactions.bankAccountId, ledgerBankAccounts.id))
    .leftJoin(
      ledgerReconciliationMatches,
      eq(ledgerReconciliationMatches.transactionId, ledgerTransactions.id),
    )
    .where(
      and(
        eq(ledgerTransactions.entityId, args.destEntityId),
        eq(ledgerTransactions.flow, "income"),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.amountCents, args.row.amountCents),
        gte(ledgerTransactions.txnDate, shiftIsoDate(args.row.txnDate, -DUPLICATE_WINDOW_DAYS)),
        lte(ledgerTransactions.txnDate, shiftIsoDate(args.row.txnDate, DUPLICATE_WINDOW_DAYS)),
        ne(ledgerTransactions.id, args.row.id),
        isNull(ledgerTransactions.transferGroupId),
      ),
    )
    .orderBy(desc(ledgerTransactions.txnDate))
    .limit(DUPLICATE_CANDIDATE_CAP);

  return rows.map((r) => ({
    id: r.id,
    txnDate: r.txnDate,
    party: r.party,
    amountCents: r.amountCents,
    fundName: r.fundName,
    bankAccountName: r.bankAccountName ?? null,
    matched: r.matchId != null,
    reconciled: r.reconciled === true || r.reconciledSessionId != null,
  }));
}

// ---------------------------------------------------------------------------
// Open-session match and the closed-session unlock block
// ---------------------------------------------------------------------------

export type OpenMatch = { id: string; sessionId: string; bankLineId: string };

/**
 * The reconciliation match on a transaction, read on the HANDLE it is given
 * (the execute path passes `tx`, after the row lock, so it reads post-lock
 * state; a concurrent match insert takes a key-share lock on the row, which
 * conflicts with `FOR UPDATE`, so match-then-move serializes). The shipped
 * `getMatchForTransaction()` takes no handle and is left alone.
 */
export async function loadOpenMatch(
  exec: SelectExec,
  transactionId: string,
): Promise<OpenMatch | null> {
  const rows = await exec
    .select({
      id: ledgerReconciliationMatches.id,
      sessionId: ledgerReconciliationMatches.sessionId,
      bankLineId: ledgerReconciliationMatches.bankLineId,
    })
    .from(ledgerReconciliationMatches)
    .where(eq(ledgerReconciliationMatches.transactionId, transactionId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadSessionInfo(
  exec: SelectExec,
  sessionId: string,
): Promise<{
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "closed";
} | null> {
  const rows = await exec
    .select({
      id: ledgerReconciliationSessions.id,
      bankAccountId: ledgerReconciliationSessions.bankAccountId,
      bankAccountName: ledgerBankAccounts.name,
      periodStart: ledgerReconciliationSessions.statementPeriodStart,
      periodEnd: ledgerReconciliationSessions.statementPeriodEnd,
      status: ledgerReconciliationSessions.status,
    })
    .from(ledgerReconciliationSessions)
    .innerJoin(
      ledgerBankAccounts,
      eq(ledgerReconciliationSessions.bankAccountId, ledgerBankAccounts.id),
    )
    .where(eq(ledgerReconciliationSessions.id, sessionId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { ...r, status: r.status === "closed" ? "closed" : "open" };
}

/**
 * The structured "before this can move" block for a cross-entity destination
 * whose denial is a state the treasurer can clear by hand. Computed ONCE per
 * request (the caller memoizes per kind) and reused across destinations.
 * Guides, never automates.
 */
export async function buildMoveUnlock(
  exec: SelectExec,
  args: {
    row: Pick<LedgerTransaction, "id" | "entityId" | "reconciledSessionId">;
    kind: MoveUnlock["kind"];
    sourceFundKind: string;
    openMatch?: OpenMatch | null;
  },
): Promise<MoveUnlock> {
  const empty: MoveUnlock = {
    kind: args.kind,
    session: null,
    laterClosedSessions: [],
    otherMatchesOnLine: 0,
    statementMonth: null,
    statementAlreadySent: false,
  };

  if (args.kind === "legacy_reconciled") return empty;

  if (args.kind === "closed_session") {
    if (!args.row.reconciledSessionId) return empty;
    const session = await loadSessionInfo(exec, args.row.reconciledSessionId);
    if (!session) return empty;
    const later = await listLaterClosedSessionsForAccount(session.bankAccountId, session.periodEnd);
    const statementMonth = session.periodEnd.slice(0, 7);
    const sent = await findSentStatementMonth(exec, {
      entityId: args.row.entityId,
      txnDate: session.periodEnd,
      fundKind: args.sourceFundKind,
    });
    return {
      kind: "closed_session",
      session: {
        id: session.id,
        bankAccountName: session.bankAccountName,
        periodStart: session.periodStart,
        periodEnd: session.periodEnd,
        status: session.status,
      },
      laterClosedSessions: later.map((s) => ({
        id: s.id,
        periodStart: s.statementPeriodStart,
        periodEnd: s.statementPeriodEnd,
      })),
      otherMatchesOnLine: 0,
      statementMonth,
      statementAlreadySent: sent !== null,
    };
  }

  // matched_open_session
  const match = args.openMatch ?? (await loadOpenMatch(exec, args.row.id));
  if (!match) return empty;
  const session = await loadSessionInfo(exec, match.sessionId);
  const others = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerReconciliationMatches)
    .where(
      and(
        eq(ledgerReconciliationMatches.bankLineId, match.bankLineId),
        ne(ledgerReconciliationMatches.id, match.id),
      ),
    );
  return {
    kind: "matched_open_session",
    session: session
      ? {
          id: session.id,
          bankAccountName: session.bankAccountName,
          periodStart: session.periodStart,
          periodEnd: session.periodEnd,
          status: session.status,
        }
      : null,
    laterClosedSessions: [],
    otherMatchesOnLine: others[0]?.n ?? 0,
    statementMonth: null,
    statementAlreadySent: false,
  };
}

// ---------------------------------------------------------------------------
// Receipt state
// ---------------------------------------------------------------------------

/** "none" | "unsent" | "sent": the state of the row's acknowledgment record. */
export async function loadReceiptState(
  exec: SelectExec,
  transactionId: string,
): Promise<"none" | "unsent" | "sent"> {
  const rows = await exec
    .select({ sentAt: ledgerAcknowledgments.sentAt })
    .from(ledgerAcknowledgments)
    .where(eq(ledgerAcknowledgments.donationTxnId, transactionId))
    .limit(1);
  if (!rows[0]) return "none";
  return rows[0].sentAt ? "sent" : "unsent";
}

// ---------------------------------------------------------------------------
// Register context (Move-button eligibility)
// ---------------------------------------------------------------------------

/**
 * Two small reads for the register's Move-button eligibility: every ACTIVE
 * fund of every entity (so eligibility is `checkFundMove()` over all funds) and
 * the entities that have an active bank account (a cross-entity destination
 * counts only when its entity can receive the cash).
 */
export async function listMoveRegisterContext(): Promise<{
  funds: Array<{ id: string; entityId: string; kind: string }>;
  entityIdsWithActiveBank: string[];
}> {
  const funds = await db
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.isActive, true));
  const banks = await db
    .select({ entityId: ledgerBankAccounts.entityId })
    .from(ledgerBankAccounts)
    .where(eq(ledgerBankAccounts.isActive, true));
  return { funds, entityIdsWithActiveBank: [...new Set(banks.map((b) => b.entityId))] };
}
