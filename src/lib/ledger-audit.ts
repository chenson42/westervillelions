/**
 * Server-only half of the ledger correction audit trail (DECISION-110/111):
 * the same-transaction writer and the "Recent corrections" reader.
 *
 * Imports `@/lib/db`. NEVER import this from a member surface
 * (src/app/members/**, src/app/api/members/**, src/lib/financial-report-*.ts):
 * the reason text is free text that may name a person. A test enforces it.
 * The pure vocabulary lives in ./ledger-correction.ts.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerAuditLog, users } from "@/lib/db/schema";
import {
  CORRECTION_AUDIT_ACTIONS,
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  isRawAudit,
  parseAuditAfter,
  parseAuditBefore,
  parseAuditDetails,
  serializeAuditPayload,
  type AuditPayloadFor,
  type CorrectionAuditAction,
  type LedgerCorrectionRow,
} from "@/lib/ledger-correction";

/** `db` or a transaction handle. */
export type AuditExecutor = Pick<typeof db, "insert">;

/**
 * Write one audit row. Pass the surrounding `tx` so the audit row and the
 * change commit or roll back together. THROWS on failure so the transaction
 * rolls back: a correction with no audit record must not exist.
 *
 * `targetCategoryId` is always null (the table's app-layer invariant: exactly
 * one target, or none). Move passes the row id; delete passes null because the
 * FK would be nulled by the delete anyway.
 */
export async function recordLedgerAudit<A extends CorrectionAuditAction>(
  exec: AuditExecutor,
  entry: { actorUserId: string; action: A; targetTransactionId: string | null } & AuditPayloadFor<A>,
): Promise<void> {
  const text = serializeAuditPayload(entry);
  await exec.insert(ledgerAuditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetCategoryId: null,
    targetTransactionId: entry.targetTransactionId,
    before: text.before,
    after: text.after,
    details: text.details,
  });
}

export const CORRECTIONS_WINDOW_DAYS = 90;
export const CORRECTIONS_FETCH_CAP = 200;
export const CORRECTIONS_DISPLAY_CAP = 25;

/**
 * The only read of the audit log: recent moves and deletes for one entity.
 *
 * Bounded by action, a date window and a fetch cap in SQL; the entity filter
 * is applied in JavaScript after parsing, because `details` is a text column
 * that holds plain prose for other actions: a SQL cast to jsonb could be
 * evaluated on those rows and fail the whole query (DECISION-111 item 6).
 * A row whose payload cannot be parsed is still listed (reason null) rather
 * than hidden; our own writers never produce one.
 */
export async function getRecentLedgerCorrections(args: {
  entityId: string;
  now?: Date;
  days?: number;
  fetchCap?: number;
  displayCap?: number;
}): Promise<{ rows: LedgerCorrectionRow[]; totalInWindow: number }> {
  const now = args.now ?? new Date();
  const days = args.days ?? CORRECTIONS_WINDOW_DAYS;
  const fetchCap = args.fetchCap ?? CORRECTIONS_FETCH_CAP;
  const displayCap = args.displayCap ?? CORRECTIONS_DISPLAY_CAP;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const fetched = await db
    .select({
      id: ledgerAuditLog.id,
      createdAt: ledgerAuditLog.createdAt,
      action: ledgerAuditLog.action,
      before: ledgerAuditLog.before,
      after: ledgerAuditLog.after,
      details: ledgerAuditLog.details,
      actorName: users.name,
    })
    .from(ledgerAuditLog)
    .leftJoin(users, eq(users.id, ledgerAuditLog.actorUserId))
    .where(
      and(
        inArray(ledgerAuditLog.action, [...CORRECTION_AUDIT_ACTIONS]),
        gte(ledgerAuditLog.createdAt, cutoff),
      ),
    )
    .orderBy(desc(ledgerAuditLog.createdAt))
    .limit(fetchCap);

  const mapped: LedgerCorrectionRow[] = [];
  for (const r of fetched) {
    if (r.action === TRANSACTION_FUND_MOVED_AUDIT_ACTION) {
      const details = parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, r.details);
      if (!isRawAudit(details) && details.entityId !== args.entityId) continue;
      const before = parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, r.before);
      const after = parseAuditAfter(r.after);
      mapped.push({
        id: r.id,
        createdAt: r.createdAt,
        actorName: r.actorName ?? null,
        kind: "moved",
        amountCents: isRawAudit(details) ? null : details.amountCents,
        flow: isRawAudit(details) ? null : details.flow,
        txnDate: isRawAudit(details) ? null : details.txnDate,
        from: isRawAudit(before) ? null : before.fund.name,
        to: isRawAudit(after) ? null : after.fund.name,
        reason: isRawAudit(details) ? null : details.reason,
        settledPeriod: isRawAudit(details) ? false : details.reconciled || details.priorFiscalYear,
        rowCount: 1,
        sentStatementMonth: isRawAudit(details) ? null : details.sentStatementMonth,
      });
    } else if (r.action === TRANSACTION_DELETED_AUDIT_ACTION) {
      const details = parseAuditDetails(TRANSACTION_DELETED_AUDIT_ACTION, r.details);
      const before = parseAuditBefore(TRANSACTION_DELETED_AUDIT_ACTION, r.before);
      if (!isRawAudit(details)) {
        // A transfer pair can span two entities; match either leg.
        const legEntities = isRawAudit(before) ? [] : before.rows.map((s) => s.entityId);
        if (details.entityId !== args.entityId && !legEntities.includes(args.entityId)) continue;
      }
      mapped.push({
        id: r.id,
        createdAt: r.createdAt,
        actorName: r.actorName ?? null,
        kind: "deleted",
        amountCents: isRawAudit(details) ? null : details.amountCents,
        flow: isRawAudit(details) ? null : details.flow,
        txnDate: isRawAudit(details) ? null : details.txnDate,
        from: isRawAudit(before) ? null : (before.rows[0]?.fund.name ?? null),
        to: null,
        reason: isRawAudit(details) ? null : details.reason,
        settledPeriod: isRawAudit(details) ? false : details.reconciled || details.priorFiscalYear,
        rowCount: isRawAudit(details) ? 1 : details.rowCount,
        sentStatementMonth: isRawAudit(details) ? null : details.sentStatementMonth,
      });
    }
  }

  return { rows: mapped.slice(0, displayCap), totalInWindow: mapped.length };
}
