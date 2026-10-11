/**
 * Approver-only reads for the Approvals page: "Recently decided" and the
 * ?txn=<id> deep-link resolver
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3 addendum A4).
 *
 * VISIBILITY RULE. Who decided what, when, and the board-minute citation are
 * visible to `ledger.approve` holders only. This module is imported by exactly
 * one file, src/app/(dashboard)/admin/ledger/approvals/page.tsx (pinned by a
 * source-scan test). It must never be imported from a member surface, the
 * register, search, the overview or reports. User ids never leave this module:
 * the returned objects carry display names and `deciderIsViewer` only.
 *
 * The board-decision predicate lives in ./ledger-board-decision.ts (R9); the
 * History and the resolver both evaluate it in SQL, so they cannot disagree.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerTransactions,
  ledgerTxnCosigns,
  users,
} from "@/lib/db/schema";
import { isUuid } from "@/lib/utils";
import { boardDecisionPredicate } from "@/lib/ledger-board-decision";
import {
  RECENT_DECISIONS_LIMIT,
  cosignEligibility,
  describeApprovalFund,
  displayDeciderName,
  type ApprovalKind,
  type ApprovalTargetState,
  type CosignerView,
  type DecidedApprovalRow,
} from "@/lib/ledger-approval";

const dest = alias(ledgerTransactions, "dest");
const destFund = alias(ledgerFunds, "dest_fund");
const partnerEntity = alias(ledgerEntities, "partner_entity");
const recorder = alias(users, "recorder");
const decider = alias(users, "decider");

function toIso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function kindOf(input: {
  fundName: string | null;
  partnerFundName: string | null;
  entityId: string;
  partnerEntityId: string | null;
}): ApprovalKind {
  const k = describeApprovalFund(input).kind;
  return k === "plain" ? "disbursement" : k;
}

/**
 * The one SELECT and the one row mapper behind both the History and the
 * `decided` banner state. LEFT JOINs are fine: nothing here is locked.
 */
async function selectDecided(args: {
  where: SQL | undefined;
  viewerUserId: string;
  limit?: number;
}): Promise<DecidedApprovalRow[]> {
  const t = ledgerTransactions;
  const decidedAtOrder = sql`coalesce(${t.approvedAt}, ${t.rejectedAt}, ${t.updatedAt})`;

  const base = db
    .select({
      id: t.id,
      status: t.status,
      approvedAt: t.approvedAt,
      rejectedAt: t.rejectedAt,
      updatedAt: t.updatedAt,
      boardMinute: t.boardMinute,
      rejectionReason: t.rejectionReason,
      amountCents: t.amountCents,
      txnDate: t.txnDate,
      party: t.party,
      memo: t.memo,
      entityId: t.entityId,
      fundName: ledgerFunds.name,
      partnerFundName: destFund.name,
      partnerEntityId: dest.entityId,
      entityName: sql<string | null>`coalesce(${ledgerEntities.shortName}, ${ledgerEntities.name})`,
      partnerEntityName: sql<string | null>`coalesce(${partnerEntity.shortName}, ${partnerEntity.name})`,
      recorderName: recorder.name,
      deciderName: decider.name,
      deciderId: decider.id,
      // Server-side only: feed cosignEligibility(); never copied to a returned object.
      recorderId: t.recordedByUserId,
      destRecorderId: dest.recordedByUserId,
      approvedById: t.approvedByUserId,
    })
    .from(t)
    .leftJoin(ledgerFunds, eq(t.fundId, ledgerFunds.id))
    .leftJoin(ledgerEntities, eq(t.entityId, ledgerEntities.id))
    .leftJoin(
      dest,
      and(eq(dest.transferGroupId, t.transferGroupId), eq(dest.flow, "income")),
    )
    .leftJoin(destFund, eq(dest.fundId, destFund.id))
    .leftJoin(partnerEntity, eq(dest.entityId, partnerEntity.id))
    .leftJoin(recorder, eq(t.recordedByUserId, recorder.id))
    .leftJoin(
      decider,
      eq(
        decider.id,
        sql`CASE WHEN ${t.status} = 'rejected' THEN ${t.rejectedByUserId} ELSE ${t.approvedByUserId} END`,
      ),
    )
    .where(args.where)
    .orderBy(desc(decidedAtOrder), desc(t.id));

  const rows = await (args.limit ? base.limit(args.limit) : base);

  // Second statement, binding (R12): the History LIMIT statement above must not
  // reference the co-sign table (a join would fan out and cap signatures, not
  // decisions). One query for all returned approved rows, skipped when there
  // are none. A failure here propagates: an approved card must never render a
  // silently incomplete signer list.
  const approvedIds = rows.filter((r) => r.status !== "rejected").map((r) => r.id);
  const cosignsByTxn = new Map<string, { userId: string | null; view: Omit<CosignerView, "isViewer"> }[]>();
  if (approvedIds.length > 0) {
    const signed = await db
      .select({
        txnId: ledgerTxnCosigns.txnId,
        cosignedAt: ledgerTxnCosigns.cosignedAt,
        userId: ledgerTxnCosigns.userId,
        name: users.name,
      })
      .from(ledgerTxnCosigns)
      .leftJoin(users, eq(users.id, ledgerTxnCosigns.userId))
      .where(inArray(ledgerTxnCosigns.txnId, approvedIds))
      .orderBy(asc(ledgerTxnCosigns.cosignedAt), asc(ledgerTxnCosigns.id));
    for (const c of signed) {
      const list = cosignsByTxn.get(c.txnId) ?? [];
      list.push({
        userId: c.userId,
        view: { name: displayDeciderName(c.name), cosignedAt: toIso(c.cosignedAt) },
      });
      cosignsByTxn.set(c.txnId, list);
    }
  }

  return rows.map((r): DecidedApprovalRow => {
    const common = {
      id: r.id,
      kind: kindOf({
        fundName: r.fundName ?? null,
        partnerFundName: r.partnerFundName ?? null,
        entityId: r.entityId,
        partnerEntityId: r.partnerEntityId ?? null,
      }),
      decidedAt: toIso(r.approvedAt ?? r.rejectedAt ?? r.updatedAt),
      deciderName: displayDeciderName(r.deciderName),
      deciderIsViewer: r.deciderId != null && r.deciderId === args.viewerUserId,
      amountCents: r.amountCents,
      txnDate: r.txnDate,
      party: r.party ?? null,
      memo: r.memo ?? null,
      fundName: r.fundName ?? null,
      partnerFundName: r.partnerFundName ?? null,
      entityId: r.entityId,
      partnerEntityId: r.partnerEntityId ?? null,
      entityName: r.entityName ?? null,
      partnerEntityName: r.partnerEntityName ?? null,
      recorderName: displayDeciderName(r.recorderName),
    };
    if (r.status === "rejected") {
      return {
        ...common,
        decision: "rejected",
        deciderOnFile: r.rejectedAt != null,
        rejectionReason: r.rejectionReason ?? null,
      };
    }
    const signers = cosignsByTxn.get(r.id) ?? [];
    // ONE eligibility result drives all three booleans (T4).
    const eligibility = cosignEligibility({
      viewerId: args.viewerUserId,
      recorderIds: [r.recorderId ?? null, r.destRecorderId ?? null],
      approvedByUserId: r.approvedById ?? null,
      cosignerUserIds: signers.map((c) => c.userId),
    });
    return {
      ...common,
      decision: "approved",
      boardMinute: r.boardMinute ?? "",
      cosigners: signers.map((c) => ({
        ...c.view,
        isViewer: c.userId !== null && c.userId === args.viewerUserId,
      })),
      canCosign: eligibility.ok,
      viewerHasCosigned: !eligibility.ok && eligibility.reason === "already_cosigned",
      viewerRecorded: !eligibility.ok && eligibility.reason === "recorded_by_you",
    };
  });
}

/**
 * The 25 most recent board decisions (approved or rejected), newest first,
 * across every entity. A Transfer/Sweep pair is one row (the expense leg).
 * Throws on a database failure; the page catches it so Pending never blanks.
 */
export async function getRecentDecisions(viewerUserId: string): Promise<DecidedApprovalRow[]> {
  return selectDecided({
    where: boardDecisionPredicate(ledgerTransactions),
    viewerUserId,
    limit: RECENT_DECISIONS_LIMIT,
  });
}

/**
 * Resolves ?txn=<raw> to a banner state. Never throws for bad input and never
 * echoes it: a non-UUID returns not_found without touching the database.
 */
export async function resolveApprovalTarget(
  rawTxn: string,
  viewerUserId: string,
): Promise<ApprovalTargetState> {
  if (typeof rawTxn !== "string" || !isUuid(rawTxn)) return { state: "not_found" };
  const t = ledgerTransactions;
  // A single-table select renders `${t.col}` UNQUALIFIED, so inside these
  // correlated subqueries (whose own FROM also has an `id` / `transfer_group_id`)
  // it would bind to the inner table, making the EXISTS always true and the
  // partner lookup match any income row. Qualify the outer references by hand.
  const outerId = sql.raw('"ledger_transactions"."id"');
  const outerGroup = sql.raw('"ledger_transactions"."transfer_group_id"');

  const found = await db
    .select({
      id: t.id,
      flow: t.flow,
      status: t.status,
      entityId: t.entityId,
      isBoardDecision: sql<boolean>`${boardDecisionPredicate(t)}`,
      partnerEntityId: sql<string | null>`(SELECT d.entity_id FROM ledger_transactions d WHERE d.transfer_group_id = ${outerGroup} AND d.flow = 'income' LIMIT 1)`,
      viewerRecorded: sql<boolean>`EXISTS (SELECT 1 FROM ledger_transactions v WHERE (v.id = ${outerId} OR (v.transfer_group_id IS NOT NULL AND v.transfer_group_id = ${outerGroup})) AND v.recorded_by_user_id = ${viewerUserId})`,
    })
    .from(t)
    .where(
      or(
        eq(t.id, rawTxn),
        eq(
          t.transferGroupId,
          sql`(SELECT transfer_group_id FROM ledger_transactions WHERE id = ${rawTxn})`,
        ),
      ),
    )
    .orderBy(sql`${t.flow} = 'expense' DESC`)
    .limit(1);

  const row = found[0];
  if (!row) return { state: "not_found" };

  const kind = kindOf({
    fundName: null,
    partnerFundName: null,
    entityId: row.entityId,
    partnerEntityId: row.partnerEntityId ?? null,
  });

  if (row.flow !== "expense") return { state: "not_board_decision", kind };
  if (row.status === "pending") {
    return { state: "pending", rowId: row.id, kind, isOwn: Boolean(row.viewerRecorded) };
  }
  if (!row.isBoardDecision) return { state: "not_board_decision", kind };

  const decided = await selectDecided({ where: eq(t.id, row.id), viewerUserId });
  const first = decided[0];
  return first ? { state: "decided", row: first } : { state: "not_found" };
}
