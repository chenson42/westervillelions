/**
 * The ONE advisory duplicate-candidate finder (B-108 / DECISION-114;
 * generalized in place from the cross-entity move's income-only query,
 * DECISION-113, not forked). Callers:
 *   - the cross-entity move, through the thin `findDuplicateCandidates()`
 *     wrapper in ./ledger-fund-move-preview.ts (pins flow = income and the
 *     destination entity, projects to MoveDuplicateCandidate);
 *   - create-from-bank-line, which asks for reimbursement-derived expenses on
 *     the session's account or with no account yet.
 *
 * ADVISORY only: it cannot see a deposit bundled with other money (B-107) and
 * never blocks anything on its own. Writes nothing. Must NOT import
 * ./ledger-audit or ./ledger-correction (member-surface firewall).
 */

import { and, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { db } from "@/lib/db";
import {
  ledgerBankAccounts,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReimbursements,
  ledgerTransactions,
} from "@/lib/db/schema";
import { isOwnReimbursementRequest } from "@/lib/ledger";
import { paidReimbursementExists } from "@/lib/ledger-reimbursement-link";
import type { CreateFromBankLineCandidate } from "@/lib/ledger-reimbursement-correction";

type SelectExec = Pick<typeof db, "select">;

export const DUPLICATE_WINDOW_DAYS = 30;
export const DUPLICATE_CANDIDATE_CAP = 5;

/** "YYYY-MM-DD" plus `days` (UTC arithmetic on the calendar date; no timezone drift). */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The superset row every caller projects from. */
export interface DuplicateCandidateRow {
  id: string;
  txnDate: string;
  party: string | null;
  amountCents: number;
  fundName: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  checkNumber: string | null;
  matched: boolean;
  reconciled: boolean;
  /** Set only for a reimbursement-derived row when `reimbursementDerivedOnly` is true. */
  reimbursementId: string | null;
  submitterUserId: string | null;
  submitterMemberId: string | null;
}

export interface FindDuplicateRowsArgs {
  entityId: string;
  flow: "income" | "expense";
  amountCents: number;
  aroundDate: string;
  excludeTransactionId?: string;
  /** Only rows a PAID reimbursement links to (also selects the submitter ids). */
  reimbursementDerivedOnly?: boolean;
  /** Only rows with no reconciliation match and neither reconciled mark. */
  unmatchedUnreconciledOnly?: boolean;
  /** Only rows with no bank account OR on this account. */
  onAccountOrUnassigned?: string;
}

/**
 * Posted rows of the entity (any fund) with the same flow and amount within 30
 * days of `aroundDate`, transfer legs excluded, newest first, capped at 5.
 */
export async function findDuplicateRows(
  exec: SelectExec,
  args: FindDuplicateRowsArgs,
): Promise<DuplicateCandidateRow[]> {
  const conditions = [
    eq(ledgerTransactions.entityId, args.entityId),
    eq(ledgerTransactions.flow, args.flow),
    eq(ledgerTransactions.status, "posted"),
    eq(ledgerTransactions.amountCents, args.amountCents),
    gte(ledgerTransactions.txnDate, shiftIsoDate(args.aroundDate, -DUPLICATE_WINDOW_DAYS)),
    lte(ledgerTransactions.txnDate, shiftIsoDate(args.aroundDate, DUPLICATE_WINDOW_DAYS)),
    isNull(ledgerTransactions.transferGroupId),
  ];
  if (args.excludeTransactionId) {
    conditions.push(ne(ledgerTransactions.id, args.excludeTransactionId));
  }
  if (args.reimbursementDerivedOnly) {
    conditions.push(paidReimbursementExists(ledgerTransactions.id));
  }
  if (args.unmatchedUnreconciledOnly) {
    conditions.push(
      eq(ledgerTransactions.reconciled, false),
      isNull(ledgerTransactions.reconciledSessionId),
      isNull(ledgerReconciliationMatches.id),
    );
  }
  if (args.onAccountOrUnassigned) {
    const account = or(
      isNull(ledgerTransactions.bankAccountId),
      eq(ledgerTransactions.bankAccountId, args.onAccountOrUnassigned),
    );
    if (account) conditions.push(account);
  }

  const rows = await exec
    .select({
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      party: ledgerTransactions.party,
      amountCents: ledgerTransactions.amountCents,
      checkNumber: ledgerTransactions.checkNumber,
      reconciled: ledgerTransactions.reconciled,
      reconciledSessionId: ledgerTransactions.reconciledSessionId,
      bankAccountId: ledgerTransactions.bankAccountId,
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
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.txnDate))
    .limit(DUPLICATE_CANDIDATE_CAP);

  const submitters = new Map<
    string,
    { reimbursementId: string; userId: string | null; memberId: string | null }
  >();
  if (args.reimbursementDerivedOnly && rows.length > 0) {
    const linked = await exec
      .select({
        id: ledgerReimbursements.id,
        transactionId: ledgerReimbursements.ledgerTransactionId,
        submittedByUserId: ledgerReimbursements.submittedByUserId,
        submittedByMemberId: ledgerReimbursements.submittedByMemberId,
      })
      .from(ledgerReimbursements)
      .where(
        and(
          inArray(
            ledgerReimbursements.ledgerTransactionId,
            rows.map((r) => r.id),
          ),
          eq(ledgerReimbursements.status, "paid"),
        ),
      );
    for (const l of linked) {
      if (l.transactionId && !submitters.has(l.transactionId)) {
        submitters.set(l.transactionId, {
          reimbursementId: l.id,
          userId: l.submittedByUserId,
          memberId: l.submittedByMemberId,
        });
      }
    }
  }

  return rows.map((r) => {
    const s = submitters.get(r.id);
    return {
      id: r.id,
      txnDate: r.txnDate,
      party: r.party,
      amountCents: r.amountCents,
      fundName: r.fundName,
      bankAccountId: r.bankAccountId ?? null,
      bankAccountName: r.bankAccountName ?? null,
      checkNumber: r.checkNumber ?? null,
      matched: r.matchId != null,
      reconciled: r.reconciled === true || r.reconciledSessionId != null,
      reimbursementId: s?.reimbursementId ?? null,
      submitterUserId: s?.userId ?? null,
      submitterMemberId: s?.memberId ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Create-from-bank-line candidates (B-108 / DECISION-114)
// ---------------------------------------------------------------------------

/** Compare a candidate's check number to the bank line's "Check or Slip #" (trimmed, case-insensitive). */
function checkNumbersMatch(a: string | null, b: string | null): boolean {
  const x = a?.trim().toLowerCase();
  const y = b?.trim().toLowerCase();
  return !!x && !!y && x === y;
}

/**
 * Advisory candidates for a DEBIT bank line about to be turned into a new
 * expense row: reimbursement-derived expenses of the same amount within 30
 * days, unmatched and unreconciled, that either have no bank account yet or sit
 * on the session's account. A credit line has none (returns []). `ownRequest`
 * is computed here, server-side, from the session user (user id OR member id).
 */
export async function findCreateFromBankLineCandidates(
  exec: SelectExec,
  args: {
    entityId: string;
    bankAccountId: string;
    bankLine: { amountCents: number; postingDate: string; checkOrSlipNumber: string | null };
    actor: { userId: string; memberId?: string | null };
  },
): Promise<CreateFromBankLineCandidate[]> {
  if (args.bankLine.amountCents >= 0) return [];
  const rows = await findDuplicateRows(exec, {
    entityId: args.entityId,
    flow: "expense",
    amountCents: Math.abs(args.bankLine.amountCents),
    aroundDate: args.bankLine.postingDate,
    reimbursementDerivedOnly: true,
    unmatchedUnreconciledOnly: true,
    onAccountOrUnassigned: args.bankAccountId,
  });
  return rows.map((r) => ({
    transactionId: r.id,
    txnDate: r.txnDate,
    party: r.party,
    amountCents: r.amountCents,
    fundName: r.fundName,
    bankAccountId: r.bankAccountId,
    bankAccountName: r.bankAccountName,
    checkNumber: r.checkNumber,
    checkNumberMatchesLine: checkNumbersMatch(r.checkNumber, args.bankLine.checkOrSlipNumber),
    needsBankAccount: r.bankAccountId === null,
    ownRequest: isOwnReimbursementRequest(
      { id: args.actor.userId, memberId: args.actor.memberId },
      { submittedByUserId: r.submitterUserId, submittedByMemberId: r.submitterMemberId },
    ),
  }));
}
