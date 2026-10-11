/**
 * Informational co-sign ("Add your approval") on a board-approved ledger
 * expense (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3
 * addendum B3; Phase 2 R10; DECISION-116 follow-on).
 *
 * The FIRST approval posts a transaction (decideTransaction()); a co-sign only
 * records that a further board member agrees. There is no quorum, and NOTHING
 * may read the existence or count of co-sign rows as authorization.
 *
 * This file writes `ledger_txn_cosigns` and nothing else: no UPDATE or DELETE
 * of ledger_transactions (scan-tested), no ledger_audit_log row, no email.
 * It is not a durable-claim path. Allowed on reconciled, prior-year and
 * closed-month rows because it changes no figure.
 *
 * Procedure (order is binding):
 *   1. malformed id -> 404 without touching the database
 *   2. one statement locks the target and its Transfer/Sweep partner FOR SHARE,
 *      ORDER BY id (conflicts with decideTransaction()'s FOR UPDATE, but not
 *      with other co-signers, so thirteen taps do not queue)
 *   3. normalise to the EXPENSE leg; everything below keys on its id, never on
 *      the id the caller passed (otherwise one person could sign once per leg
 *      and the unique key would not stop it)
 *   4. pending / rejected / not a board approval (boardApprovalPredicate, in SQL)
 *   5. eligibility via the shared cosignEligibility()
 *   6. INSERT ... ON CONFLICT (txn_id, user_id) DO NOTHING; zero rows is
 *      already_cosigned
 *
 * Server-only (imports db). Imported only by the cosign route.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerTxnCosigns } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils";
import { boardApprovalPredicate, lockDecisionPair } from "@/lib/ledger-board-decision";
import { lookupDeciderName } from "@/lib/ledger-approval-decision";
import {
  cosignEligibility,
  displayDeciderName,
  type ApprovalNotFoundBody,
  type CosignConflictBody,
  type CosignForbiddenBody,
} from "@/lib/ledger-approval";

export type CosignResult =
  | { ok: true; id: string; cosignedAt: Date }
  | { ok: false; status: 403; body: CosignForbiddenBody }
  | { ok: false; status: 404; body: ApprovalNotFoundBody }
  | { ok: false; status: 409; body: CosignConflictBody };

const NOT_FOUND: CosignResult = {
  ok: false,
  status: 404,
  body: { error: "Transaction not found", code: "not_found" },
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function conflict(
  code: CosignConflictBody["code"],
  error: string,
  extra: { at?: string | null; deciderName?: string | null } = {},
): CosignResult {
  return {
    ok: false,
    status: 409,
    body: { error, code, at: extra.at ?? null, deciderName: extra.deciderName ?? null },
  };
}

const MESSAGES = {
  not_approved: "This entry is still waiting for its first approval",
  rejected: "This entry was rejected",
  not_board_decision: "This entry did not need board approval",
  already_approved: "You already approved this entry",
  already_cosigned: "You already added your approval",
  recorded_by_you:
    "You recorded this entry, so another board member needs to approve it",
} as const;

export async function cosignTransaction(args: {
  id: string;
  actorUserId: string;
  now?: Date;
}): Promise<CosignResult> {
  const { id, actorUserId } = args;
  // 1. A malformed id would throw a Postgres 22P02; it cannot exist, so 404.
  if (!isUuid(id)) return { ...NOT_FOUND };
  const now = args.now ?? new Date();

  return db.transaction(async (tx): Promise<CosignResult> => {
    // 2. Lock the target and its pair partner, shared, in id order.
    const locked = await lockDecisionPair(tx, id, "share");
    const target = locked.find((r) => r.id === id);
    if (!target) return { ...NOT_FOUND };

    // A pair is exactly two legs; anything else is a data fault.
    if (target.transferGroupId ? locked.length !== 2 : locked.length !== 1) {
      return conflict("not_board_decision", MESSAGES.not_board_decision);
    }

    // 3. Normalise to the expense leg. A lone income row has none.
    const expense = locked.find((r) => r.flow === "expense");
    if (!expense) return conflict("not_board_decision", MESSAGES.not_board_decision);

    // 4. State, in order: pending, rejected, then the board-approval predicate.
    if (expense.status === "pending") {
      return conflict("not_approved", MESSAGES.not_approved);
    }
    if (expense.status === "rejected") {
      return conflict("rejected", MESSAGES.rejected, {
        at: toIso(expense.rejectedAt ?? expense.updatedAt),
        deciderName: displayDeciderName(await lookupDeciderName(tx, expense)),
      });
    }
    const verdict = await tx
      .select({ ok: sql<boolean>`${boardApprovalPredicate(ledgerTransactions)}` })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, expense.id))
      .limit(1);
    if (!verdict[0]?.ok) return conflict("not_board_decision", MESSAGES.not_board_decision);

    // 5. Eligibility. Existing co-signers are handled by the unique key below.
    const eligibility = cosignEligibility({
      viewerId: actorUserId,
      recorderIds: locked.map((r) => r.recordedByUserId),
      approvedByUserId: expense.approvedByUserId,
      cosignerUserIds: [],
    });
    if (!eligibility.ok) {
      switch (eligibility.reason) {
        case "recorded_by_you":
          return {
            ok: false,
            status: 403,
            body: { error: MESSAGES.recorded_by_you, code: "recorded_by_you" },
          };
        case "already_approved":
          return conflict("already_approved", MESSAGES.already_approved, {
            at: toIso(expense.approvedAt),
          });
        case "already_cosigned":
          return conflict("already_cosigned", MESSAGES.already_cosigned);
        default: {
          const _exhaustive: never = eligibility.reason;
          return _exhaustive;
        }
      }
    }

    // 6. One idempotent INSERT keyed on the EXPENSE leg. Zero rows: this user
    //    already co-signed (double tap, two devices, or the other leg's id).
    const inserted = await tx
      .insert(ledgerTxnCosigns)
      .values({ txnId: expense.id, userId: actorUserId, cosignedAt: now })
      .onConflictDoNothing({ target: [ledgerTxnCosigns.txnId, ledgerTxnCosigns.userId] })
      .returning({ id: ledgerTxnCosigns.id, cosignedAt: ledgerTxnCosigns.cosignedAt });
    if (inserted.length === 0) {
      const existing = await tx
        .select({ cosignedAt: ledgerTxnCosigns.cosignedAt })
        .from(ledgerTxnCosigns)
        .where(
          and(eq(ledgerTxnCosigns.txnId, expense.id), eq(ledgerTxnCosigns.userId, actorUserId)),
        )
        .limit(1);
      return conflict("already_cosigned", MESSAGES.already_cosigned, {
        at: toIso(existing[0]?.cosignedAt),
      });
    }
    return { ok: true, id: expense.id, cosignedAt: inserted[0].cosignedAt };
  });
}
