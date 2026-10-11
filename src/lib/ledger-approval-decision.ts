/**
 * Race-safe board decision (approve / reject) on a pending ledger transaction
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3 rulings
 * 3, 4, 5, 12 and 13; DECISION-058 for the Transfer/Sweep pair rule).
 *
 * Both routes are thin wrappers over decideTransaction(). The shape:
 *   1. ONE statement locks the target and its Transfer/Sweep partner
 *      (`ORDER BY id FOR UPDATE`, so two concurrent pair decisions cannot
 *      deadlock).
 *   2. Not pending (target or partner) -> 409 naming the decider.
 *   3. Self rule: the actor recorded ANY locked row -> 403.
 *   4. Input validation, after the lock because "minute required only when
 *      the row has none" needs the locked row. No write has happened, so
 *      returning from the transaction here commits nothing.
 *   5. ONE UPDATE across the locked ids, pinned `AND status = 'pending'`. A
 *      short count throws StaleDecisionRollback so the transaction rolls back
 *      (a plain `return` from db.transaction commits).
 *   6. The sentinel is caught outside the transaction, the row is re-read
 *      once, and the same 409 body is returned.
 *
 * Server-only (imports db). The client-safe 409 body type and copy live in
 * ./ledger-approval.ts. approvedAt is the lock marker every PATCH / DELETE /
 * split guard keys on, and is never written for a rejection.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerTransactions, users } from "@/lib/db/schema";
import type { LedgerTransaction } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils";
import { lockDecisionPair } from "@/lib/ledger-board-decision";
import {
  displayDeciderName,
  type ApprovalConflictBody,
  type ApprovalDecision,
} from "@/lib/ledger-approval";

export const BOARD_MINUTE_MAX_LEN = 500;
export const REJECTION_REASON_MAX_LEN = 1000;

export type DecideInput =
  | { kind: "approve"; boardMinute: unknown }
  | { kind: "reject"; reason: unknown };

export type DecideResult =
  | { ok: true; id: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      body: { error: string; code?: string } | ApprovalConflictBody;
    };

/** Thrown by the pinned UPDATE on a short count so the transaction rolls back. */
class StaleDecisionRollback extends Error {
  constructor() {
    super("stale_decision_rollback");
    this.name = "StaleDecisionRollback";
  }
}

const NOT_PENDING_MESSAGE = "Transaction is no longer pending";
const PARTNER_NOT_PENDING_MESSAGE = "The paired transaction is no longer pending";

type DecisionRow = Pick<
  LedgerTransaction,
  | "id"
  | "status"
  | "approvedByUserId"
  | "approvedAt"
  | "rejectedByUserId"
  | "rejectedAt"
  | "updatedAt"
>;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pure classification of a non-pending row into the 409 body.
 * decision = "approved" iff status 'posted' AND approvedAt set; "rejected" iff
 * status 'rejected'; otherwise null. decidedAt is approvedAt, or for a
 * rejection rejectedAt (falling back to updatedAt for a legacy row with no
 * stamp; decidedByViewer is then false). `deciderName` is
 * the already-looked-up display name; it is passed through
 * displayDeciderName() so an email-shaped name can never leave this function.
 */
export function conflictFromRow(
  row: DecisionRow,
  deciderName: string | null,
  viewerId: string,
  error: string = NOT_PENDING_MESSAGE,
): ApprovalConflictBody {
  let decision: ApprovalDecision | null = null;
  let decidedAt: string | null = null;
  let decidedByViewer = false;
  if (row.status === "posted" && row.approvedAt) {
    decision = "approved";
    decidedAt = toIso(row.approvedAt);
    decidedByViewer = row.approvedByUserId !== null && row.approvedByUserId === viewerId;
  } else if (row.status === "rejected") {
    decision = "rejected";
    decidedAt = toIso(row.rejectedAt ?? row.updatedAt);
    decidedByViewer = row.rejectedByUserId !== null && row.rejectedByUserId === viewerId;
  }
  return {
    error,
    code: "not_pending",
    decision,
    deciderName: displayDeciderName(deciderName),
    decidedAt,
    decidedByViewer,
  };
}

type Reader = Pick<typeof db, "select">;

/**
 * Display name of whoever decided the row: the approver for a posted row with
 * approvedAt, the rejector for a rejected row, otherwise (or with a null id)
 * null and no query. A separate select, never a LEFT JOIN: Postgres rejects
 * FOR UPDATE on the nullable side of an outer join.
 */
export async function lookupDeciderName(reader: Reader, row: DecisionRow): Promise<string | null> {
  let deciderId: string | null = null;
  if (row.status === "posted" && row.approvedAt) deciderId = row.approvedByUserId;
  else if (row.status === "rejected") deciderId = row.rejectedByUserId;
  if (!deciderId) return null;
  const found = await reader
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, deciderId))
    .limit(1);
  return found[0]?.name ?? null;
}

async function buildConflict(
  reader: Reader,
  row: DecisionRow,
  viewerId: string,
  error: string,
): Promise<ApprovalConflictBody> {
  return conflictFromRow(row, await lookupDeciderName(reader, row), viewerId, error);
}

const NOT_FOUND = {
  ok: false,
  status: 404,
  body: { error: "Transaction not found", code: "not_found" },
} as const;

async function run(args: {
  id: string;
  actorUserId: string;
  input: DecideInput;
  now: Date;
}): Promise<DecideResult> {
  const { id, actorUserId, input, now } = args;
  const verb = input.kind === "approve" ? "approve" : "reject";

  return db.transaction(async (tx): Promise<DecideResult> => {
    // 1. One statement locks the target and its pair partner (shared helper;
    //    the co-sign path takes the same lock in "share" mode).
    const locked = await lockDecisionPair(tx, id, "update");

    const target = locked.find((r) => r.id === id);
    if (!target) return { ...NOT_FOUND };

    // A pair is exactly two legs; anything else is a data fault. Refuse to
    // write rather than decide half of something unexpected.
    if (target.transferGroupId ? locked.length !== 2 : locked.length !== 1) {
      return {
        ok: false,
        status: 409,
        body: await buildConflict(tx, target, actorUserId, PARTNER_NOT_PENDING_MESSAGE),
      };
    }

    // 2. Not pending: 409 naming the decider.
    if (target.status !== "pending") {
      return {
        ok: false,
        status: 409,
        body: await buildConflict(tx, target, actorUserId, NOT_PENDING_MESSAGE),
      };
    }
    const blockingPartner = locked.find((r) => r.id !== id && r.status !== "pending");
    if (blockingPartner) {
      return {
        ok: false,
        status: 409,
        body: await buildConflict(tx, blockingPartner, actorUserId, PARTNER_NOT_PENDING_MESSAGE),
      };
    }

    // 3. Self rule covers either leg.
    if (locked.some((r) => r.recordedByUserId === actorUserId)) {
      return {
        ok: false,
        status: 403,
        body: { error: `You cannot ${verb} a transaction you recorded` },
      };
    }

    // 4. Input. Nothing has been written, so returning commits nothing.
    let stamps: Partial<typeof ledgerTransactions.$inferInsert>;
    if (input.kind === "approve") {
      const provided =
        typeof input.boardMinute === "string" ? input.boardMinute.trim() : "";
      const boardMinute = provided
        ? provided.slice(0, BOARD_MINUTE_MAX_LEN)
        : target.boardMinute;
      if (!boardMinute) {
        return { ok: false, status: 400, body: { error: "boardMinute is required" } };
      }
      stamps = {
        status: "posted",
        approvedByUserId: actorUserId,
        approvedAt: now,
        boardMinute,
        updatedAt: now,
      };
    } else {
      const raw = input.reason;
      if (!raw || typeof raw !== "string" || !raw.trim()) {
        return { ok: false, status: 400, body: { error: "reason is required" } };
      }
      stamps = {
        status: "rejected",
        rejectionReason: raw.trim().slice(0, REJECTION_REASON_MAX_LEN),
        rejectedByUserId: actorUserId,
        rejectedAt: now,
        updatedAt: now,
      };
    }

    // 5. The pinned write: both legs in one statement, only while pending.
    const ids = locked.map((r) => r.id);
    const updated = await tx
      .update(ledgerTransactions)
      .set(stamps)
      .where(
        and(inArray(ledgerTransactions.id, ids), eq(ledgerTransactions.status, "pending")),
      )
      .returning({ id: ledgerTransactions.id });
    if (updated.length !== ids.length) throw new StaleDecisionRollback();

    return { ok: true, id };
  });
}

export async function decideTransaction(args: {
  id: string;
  actorUserId: string;
  input: DecideInput;
  now?: Date;
}): Promise<DecideResult> {
  // A malformed id would throw a Postgres 22P02 on the uuid comparison and
  // surface as a 500; it cannot exist, so it is a 404.
  if (!isUuid(args.id)) return { ...NOT_FOUND };

  try {
    return await run({ ...args, now: args.now ?? new Date() });
  } catch (err) {
    if (!(err instanceof StaleDecisionRollback)) throw err;
    // 6. Lost a race the lock should have prevented. Re-read once and answer.
    const rows = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, args.id))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...NOT_FOUND };
    return {
      ok: false,
      status: 409,
      body: await buildConflict(db, row, args.actorUserId, NOT_PENDING_MESSAGE),
    };
  }
}
