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
import type { AuditNoteAction } from "@/lib/ledger-audit-notes";
import {
  CORRECTION_AUDIT_ACTIONS,
  TRANSACTION_CORRECTED_AUDIT_ACTION,
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
import { describeCorrectionChanges } from "@/lib/ledger-reimbursement-correction";

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

/**
 * Write one lightweight audit NOTE (fund_updated, donor_deleted,
 * ledger_settings_updated; DECISION-115) through the supplied executor, so the
 * row commits or rolls back with the change. THROWS on failure: a change with
 * no audit row must not commit. Both targets are null. `before` / `after` are
 * JSON of plain objects (or null); `details` is a plain sentence. Never put an
 * email address, postal address or phone number in any of them. These rows are
 * outside CORRECTION_AUDIT_ACTIONS, so the board-visible corrections reader
 * never lists them.
 */
export async function recordLedgerAuditNote(
  exec: AuditExecutor,
  entry: {
    actorUserId: string;
    action: AuditNoteAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    details: string;
  },
): Promise<void> {
  await exec.insert(ledgerAuditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetCategoryId: null,
    targetTransactionId: null,
    before: entry.before === null ? null : JSON.stringify(entry.before),
    after: entry.after === null ? null : JSON.stringify(entry.after),
    details: entry.details,
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
    // Filtered to CORRECTION_AUDIT_ACTIONS in SQL above; the switch is exhaustive
    // over that vocabulary, so a fourth action is a compile error here.
    const action = r.action as CorrectionAuditAction;
    switch (action) {
      case TRANSACTION_FUND_MOVED_AUDIT_ACTION: {
        const details = parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, r.details);
        if (!isRawAudit(details)) {
          // A cross-entity (v2) move is listed under BOTH entities' pages; v1
          // moves only know the one entity. The delete reader applies the same
          // any-leg rule.
          const entityIds =
            details.v === 2 ? [details.entityId, details.destEntityId] : [details.entityId];
          if (!entityIds.includes(args.entityId)) continue;
        }
        const before = parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, r.before);
        const after = parseAuditAfter(r.after);
        const v2Details = !isRawAudit(details) && details.v === 2 ? details : null;
        const v2Before = !isRawAudit(before) && before.v === 2 ? before : null;
        const v2After = !isRawAudit(after) && after.v === 2 ? after : null;
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
          crossEntity: v2Details !== null,
          fromEntityName: v2Before?.entity.name ?? null,
          toEntityName: v2After?.entity.name ?? null,
          fromBankAccount: v2Before?.bankAccount?.name ?? null,
          toBankAccount: v2After?.bankAccount.name ?? null,
          receiptSent:
            v2Details !== null &&
            v2Details.acknowledgment.sent === true &&
            v2Details.acknowledgment.outcome === "kept",
        });
        break;
      }
      case TRANSACTION_DELETED_AUDIT_ACTION: {
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
          crossEntity: false,
          fromEntityName: null,
          toEntityName: null,
          fromBankAccount: null,
          toBankAccount: null,
          receiptSent: false,
        });
        break;
      }
      case TRANSACTION_CORRECTED_AUDIT_ACTION: {
        const details = parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, r.details);
        const before = parseAuditBefore(TRANSACTION_CORRECTED_AUDIT_ACTION, r.before);
        const after = parseAuditAfter(TRANSACTION_CORRECTED_AUDIT_ACTION, r.after);
        // The payload carries its own entity (DECISION-111 item 6); an unparseable
        // row is still listed (reason null) rather than hidden.
        if (!isRawAudit(details) && details.entityId !== args.entityId) continue;
        mapped.push({
          id: r.id,
          createdAt: r.createdAt,
          actorName: r.actorName ?? null,
          kind: "corrected",
          amountCents: isRawAudit(details) ? null : details.amountCents,
          flow: isRawAudit(details) ? null : details.flow,
          txnDate: isRawAudit(details) ? null : details.txnDate,
          from: null,
          to: null,
          reason: isRawAudit(details) ? null : details.reason,
          settledPeriod: isRawAudit(details) ? false : details.reconciled || details.priorFiscalYear,
          rowCount: 1,
          sentStatementMonth: isRawAudit(details) ? null : details.sentStatementMonth,
          crossEntity: false,
          fromEntityName: null,
          toEntityName: null,
          fromBankAccount: null,
          toBankAccount: null,
          receiptSent: false,
          // Labels only: memo TEXT is never composed into the list.
          changes: isRawAudit(before) || isRawAudit(after) ? [] : describeCorrectionChanges(before, after),
        });
        break;
      }
      default: {
        const unreachable: never = action;
        void unreachable;
      }
    }
  }

  return { rows: mapped.slice(0, displayCap), totalInWindow: mapped.length };
}

/**
 * The most recent `transaction_fund_moved` audit row for one transaction, for
 * the sweep memo prefill (DECISION-112 / Gap 10): the date comes from the audit
 * row, never the page-load clock. `targetTransactionId` survives a move (the
 * row is kept). `sourceLabel` is "the " + the source entity's display name for
 * a v2 move, and the source fund's name minus a trailing " Fund" for a v1
 * move; null when the row is raw or absent.
 *
 * Plain equality on two columns (uses `ix_ledger_audit_log_transaction`); the
 * payload is parsed in JavaScript, never cast to jsonb in SQL (DECISION-111
 * item 6).
 */
export async function getLatestFundMove(
  transactionId: string,
): Promise<{ createdAt: Date; sourceLabel: string } | null> {
  const rows = await db
    .select({
      createdAt: ledgerAuditLog.createdAt,
      before: ledgerAuditLog.before,
    })
    .from(ledgerAuditLog)
    .where(
      and(
        eq(ledgerAuditLog.action, TRANSACTION_FUND_MOVED_AUDIT_ACTION),
        eq(ledgerAuditLog.targetTransactionId, transactionId),
      ),
    )
    .orderBy(desc(ledgerAuditLog.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const before = parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, row.before);
  if (isRawAudit(before)) return null;
  const sourceLabel =
    before.v === 2 ? `the ${before.entity.name}` : before.fund.name.replace(/ Fund$/, "");
  return { createdAt: row.createdAt, sourceLabel };
}
