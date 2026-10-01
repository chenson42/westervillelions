/**
 * Fixtures for the cross-entity move specs (DECISION-112/113,
 * docs/work-log/2026-10-01-cross-entity-transaction-move.md).
 *
 * Direct DB inserts on the real dev DB (`DATABASE_URL`, never prod). Every row
 * carries the shared "E2E QA Move" tag (party / donor name / reason text) so
 * `cleanupMoveTransactionFixtures()` removes exactly these rows; fixture
 * reconciliation sessions use `MOVE_FIXTURE_SESSION_CSV` for the same reason.
 * Donors use example.com addresses only (no personal data in the repo). Nothing
 * here sends email, and fixture amounts stay under the disbursement approval
 * threshold so a recorded sweep posts immediately and notifies nobody.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  ledgerAcknowledgments,
  ledgerBankAccounts,
  ledgerBankLines,
  ledgerCategories,
  ledgerDonors,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReconciliationSessions,
  ledgerTransactions,
  users,
} from "../../src/lib/db/schema";
import { MOVE_FIXTURE_SESSION_CSV, MOVE_FIXTURE_TAG } from "./ledger-fixture-cleanup";

export interface XmIds {
  adminUserId: string;
  clubEntityId: string;
  foundationEntityId: string;
  adminFundId: string;
  activityFundId: string;
  charitableFundId: string;
  adminBankId: string;
  pettyCashBankId: string;
  foundationBankId: string;
  /** Club Activity "Public donations" income category, when the dev DB has it. */
  clubActivityPublicDonationsId: string | null;
  foundationPublicDonationsId: string;
}

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export async function loadXmIds(): Promise<XmIds> {
  const email = process.env.E2E_ADMIN_EMAIL ?? "";
  const adminUserId = (
    await one(db.select({ id: users.id }).from(users).where(eq(users.email, email)), "e2e admin user")
  ).id;
  const club = await one(db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "club")), "club entity");
  const foundation = await one(
    db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "foundation")),
    "foundation entity",
  );
  const fund = async (entityId: string, slug: string) =>
    (
      await one(
        db.select().from(ledgerFunds).where(and(eq(ledgerFunds.entityId, entityId), eq(ledgerFunds.slug, slug))),
        `fund ${slug}`,
      )
    ).id;
  const bank = async (entityId: string, name: string) =>
    (
      await one(
        db
          .select()
          .from(ledgerBankAccounts)
          .where(and(eq(ledgerBankAccounts.entityId, entityId), eq(ledgerBankAccounts.name, name))),
        `bank ${name}`,
      )
    ).id;
  const category = async (entityId: string, fundKind: string) =>
    (
      await db
        .select()
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, entityId),
            eq(ledgerCategories.fundKind, fundKind),
            eq(ledgerCategories.flow, "income"),
            eq(ledgerCategories.name, "Public donations"),
          ),
        )
    )[0]?.id ?? null;

  const foundationCategory = await category(foundation.id, "charitable");
  if (!foundationCategory) throw new Error("e2e fixture lookup failed: Foundation Public donations category");

  return {
    adminUserId,
    clubEntityId: club.id,
    foundationEntityId: foundation.id,
    adminFundId: await fund(club.id, "administrative"),
    activityFundId: await fund(club.id, "activity"),
    charitableFundId: await fund(foundation.id, "charitable"),
    adminBankId: await bank(club.id, "Administrative Checking"),
    pettyCashBankId: await bank(club.id, "Petty Cash"),
    foundationBankId: await bank(foundation.id, "Foundation Checking"),
    clubActivityPublicDonationsId: await category(club.id, "activity"),
    foundationPublicDonationsId: foundationCategory,
  };
}

export type AckState = "none" | "sent" | "unsent";

export interface SeededGift {
  txnId: string;
  party: string;
  donorId: string | null;
  ackId: string | null;
}

let seq = 0;

/**
 * A Foundation Charitable income row on Foundation Checking (current fiscal year
 * by default), with an `example.com` donor and an optional acknowledgment. A
 * `sent` acknowledgment is a printed letter with text on file, stamped with no
 * issuer unless `stampDonee` (rows written by old code have a NULL stamp).
 */
export async function seedFoundationGift(
  ids: XmIds,
  opts: {
    party: string;
    amountCents?: number;
    txnDate?: string;
    ack?: AckState;
    stampDonee?: boolean;
    donor?: boolean;
  },
): Promise<SeededGift> {
  const amountCents = opts.amountCents ?? 5000;
  const txnDate = opts.txnDate ?? todayIso();
  const party = opts.party.startsWith(MOVE_FIXTURE_TAG) ? opts.party : `${MOVE_FIXTURE_TAG} ${opts.party}`;

  let donorId: string | null = null;
  if (opts.donor !== false) {
    donorId = (
      await db
        .insert(ledgerDonors)
        .values({
          name: `${MOVE_FIXTURE_TAG} Donor ${++seq}-${Date.now()}`,
          emails: [`e2e-qa-donor-${seq}-${Date.now()}@example.com`],
        })
        .returning({ id: ledgerDonors.id })
    )[0].id;
  }

  const txnId = (
    await db
      .insert(ledgerTransactions)
      .values({
        entityId: ids.foundationEntityId,
        fundId: ids.charitableFundId,
        bankAccountId: ids.foundationBankId,
        txnDate,
        flow: "income",
        categoryId: ids.foundationPublicDonationsId,
        amountCents,
        party,
        donorId,
        paymentMethod: "check",
        status: "posted",
        recordedByUserId: ids.adminUserId,
      })
      .returning({ id: ledgerTransactions.id })
  )[0].id;

  let ackId: string | null = null;
  const ack = opts.ack ?? "none";
  if (ack !== "none") {
    ackId = (
      await db
        .insert(ledgerAcknowledgments)
        .values({
          donationTxnId: txnId,
          donorId,
          doneeEntityId: opts.stampDonee ? ids.foundationEntityId : null,
          amountCents,
          txnDate,
          type: "written_ack_250",
          ...(ack === "sent"
            ? {
                sentAt: new Date(),
                sentVia: "print",
                letterText: `${MOVE_FIXTURE_TAG} letter as issued by the Foundation`,
              }
            : {}),
        })
        .returning({ id: ledgerAcknowledgments.id })
    )[0].id;
  }
  return { txnId, party, donorId, ackId };
}

/**
 * A session on `bankAccountId` with one bank line matching `txnId` (signed
 * amount = the row's income amount). `closed` also stamps the row as cleared by
 * the session, exactly as the close route does; `open` leaves it matched but
 * unreconciled (the state a reopen leaves).
 */
export async function seedSessionWithMatch(args: {
  ids: XmIds;
  txnId: string;
  amountCents: number;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "closed";
}): Promise<{ sessionId: string; bankLineId: string; matchId: string }> {
  const { ids, txnId } = args;
  const sessionId = (
    await db
      .insert(ledgerReconciliationSessions)
      .values({
        bankAccountId: args.bankAccountId,
        statementPeriodStart: args.periodStart,
        statementPeriodEnd: args.periodEnd,
        openingBalanceCents: 0,
        closingBalanceCents: args.amountCents,
        status: args.status,
        csvFilename: MOVE_FIXTURE_SESSION_CSV,
        ...(args.status === "closed" ? { closedAt: new Date() } : {}),
      })
      .returning({ id: ledgerReconciliationSessions.id })
  )[0].id;
  const bankLineId = (
    await db
      .insert(ledgerBankLines)
      .values({
        sessionId,
        bankAccountId: args.bankAccountId,
        postingDate: args.periodStart,
        description: `${MOVE_FIXTURE_TAG} deposit`,
        amountCents: args.amountCents,
        dedupeKey: `${MOVE_FIXTURE_TAG}-${sessionId}-${txnId}`,
      })
      .returning({ id: ledgerBankLines.id })
  )[0].id;
  const matchId = (
    await db
      .insert(ledgerReconciliationMatches)
      .values({ sessionId, bankLineId, transactionId: txnId, createdByUserId: ids.adminUserId })
      .returning({ id: ledgerReconciliationMatches.id })
  )[0].id;
  if (args.status === "closed") {
    await db
      .update(ledgerTransactions)
      .set({ reconciled: true, reconciledAt: new Date(), reconciledSessionId: sessionId })
      .where(eq(ledgerTransactions.id, txnId));
  }
  return { sessionId, bankLineId, matchId };
}

/** An empty closed session (a LATER period that blocks reopening an earlier one). */
export async function seedEmptyClosedSession(
  bankAccountId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string> {
  return (
    await db
      .insert(ledgerReconciliationSessions)
      .values({
        bankAccountId,
        statementPeriodStart: periodStart,
        statementPeriodEnd: periodEnd,
        openingBalanceCents: 0,
        closingBalanceCents: 0,
        status: "closed",
        csvFilename: MOVE_FIXTURE_SESSION_CSV,
        closedAt: new Date(),
      })
      .returning({ id: ledgerReconciliationSessions.id })
  )[0].id;
}

/** The six-key cross-entity move body (Foundation Charitable -> Club Activity on Administrative Checking). */
export function crossEntityMoveBody(ids: XmIds, over: Record<string, unknown> = {}) {
  return {
    destFundId: ids.activityFundId,
    categoryId: ids.clubActivityPublicDonationsId,
    reason: `${MOVE_FIXTURE_TAG}: gift was deposited in the Club's account`,
    expectedFundId: ids.charitableFundId,
    destBankAccountId: ids.adminBankId,
    ...over,
  };
}
