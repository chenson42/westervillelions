/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/create-from-bank-line
 *
 * One-click shortcut for bank fees, interest, and other missed entries: given
 * an unmatched bank line, creates a new posted ledger transaction and matches
 * it to that line in one atomic step. Date, amount, and bank account are
 * ALWAYS server-derived from the bank line — never client-supplied — so the
 * new transaction can never disagree with the statement row it's clearing
 * against. Validation otherwise mirrors POST /api/admin/ledger/transactions
 * (fund/category/party/paymentMethod/checkNumber rules duplicated here
 * per-route, matching this codebase's existing convention of small validators
 * living alongside each route rather than a shared cross-route import).
 *
 * Status is always 'posted' — unlike the normal creation route, this
 * transaction is being recorded because it already cleared the bank
 * (evidenced by the statement line itself), so the disbursement-approval
 * threshold does not apply.
 *
 * Gate: LEDGER_RECORD
 *
 * Body:
 * {
 *   bankLineId: string;
 *   fundId: string;
 *   categoryId?: string;
 *   party?: string;           // required when flow='income'
 *   memo?: string;
 *   flow: 'income' | 'expense';
 *   paymentMethod?: string;   // 'check' | 'cash' | 'zeffy' | 'debit_card' | 'other'
 *   checkNumber?: string | null;
 * }
 * Response 201: { transactionId, matchId }
 *
 * Errors:
 *   400 — validation failure (flow, fund/category mismatch, party required, etc.)
 *   404 — session, bank line, fund, or category not found
 *   409 — session not open, or bank line already matched
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerFunds,
  ledgerCategories,
  ledgerReconciliationMatches,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getBankLineById,
  getMatchForBankLine,
} from "@/lib/reconciliation-queries";

const VALID_FLOWS = ["income", "expense"] as const;
const VALID_METHODS = ["check", "cash", "zeffy", "debit_card", "other"] as const;
const CHECK_NUMBER_MAX_LEN = 20;

type Flow = (typeof VALID_FLOWS)[number];

function isValidFlow(v: unknown): v is Flow {
  return typeof v === "string" && (VALID_FLOWS as readonly string[]).includes(v);
}
function isValidMethod(v: unknown): boolean {
  return typeof v === "string" && (VALID_METHODS as readonly string[]).includes(v);
}

/** Trim and length-cap checkNumber (T-18) — mirrors transactions/route.ts. */
function normalizeCheckNumber(v: unknown): { value: string | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "checkNumber must be a string" };
  const trimmed = v.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > CHECK_NUMBER_MAX_LEN) {
    return { error: `checkNumber must not exceed ${CHECK_NUMBER_MAX_LEN} characters` };
  }
  return { value: trimmed };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { bankLineId, fundId, categoryId, party, memo, flow, paymentMethod, checkNumber } =
      body ?? {};

    // Session must be open
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json(
        { error: "Reopen this session before adding a transaction" },
        { status: 409 },
      );
    }

    // Bank line belongs to this session and has no existing match
    if (!bankLineId || typeof bankLineId !== "string") {
      return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
    }
    const bankLine = await getBankLineById(sessionId, bankLineId);
    if (!bankLine) {
      return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
    }
    const existingMatch = await getMatchForBankLine(bankLineId);
    if (existingMatch) {
      return NextResponse.json(
        { error: "This bank line is already matched — unmatch it first" },
        { status: 409 },
      );
    }

    // Flow
    if (!isValidFlow(flow)) {
      return NextResponse.json(
        { error: "flow must be 'income' or 'expense'" },
        { status: 400 },
      );
    }

    // Fund — required, must belong to this session's entity
    if (!fundId || typeof fundId !== "string") {
      return NextResponse.json({ error: "fundId is required" }, { status: 400 });
    }
    const fundRows = await db
      .select({ id: ledgerFunds.id, kind: ledgerFunds.kind, entityId: ledgerFunds.entityId })
      .from(ledgerFunds)
      .where(eq(ledgerFunds.id, fundId))
      .limit(1);
    const fund = fundRows[0];
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }
    if (fund.entityId !== reconSession.entityId) {
      return NextResponse.json(
        { error: "Fund does not belong to the specified entity" },
        { status: 400 },
      );
    }

    // Category — optional, must match fund kind + flow
    if (categoryId !== undefined && categoryId !== null) {
      if (typeof categoryId !== "string") {
        return NextResponse.json({ error: "categoryId must be a string" }, { status: 400 });
      }
      const catRows = await db
        .select({
          id: ledgerCategories.id,
          fundKind: ledgerCategories.fundKind,
          flow: ledgerCategories.flow,
        })
        .from(ledgerCategories)
        .where(eq(ledgerCategories.id, categoryId))
        .limit(1);
      const cat = catRows[0];
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
      if (cat.fundKind !== fund.kind) {
        return NextResponse.json(
          { error: "Category does not match fund type" },
          { status: 400 },
        );
      }
      if (cat.flow !== flow) {
        return NextResponse.json(
          { error: "Category flow does not match transaction flow" },
          { status: 400 },
        );
      }
    }

    // Party — required for income
    let cleanParty: string | null = null;
    if (flow === "income" && (!party || typeof party !== "string" || !party.trim())) {
      return NextResponse.json(
        { error: "party is required for income transactions" },
        { status: 400 },
      );
    }
    if (party !== undefined && party !== null && typeof party === "string" && party.trim()) {
      cleanParty = party.trim();
    }

    // Payment method — optional
    if (paymentMethod !== undefined && paymentMethod !== null && !isValidMethod(paymentMethod)) {
      return NextResponse.json(
        { error: "paymentMethod must be one of: check, cash, zeffy, debit_card, other" },
        { status: 400 },
      );
    }

    // Check number — optional
    const checkNumberResult = normalizeCheckNumber(checkNumber);
    if ("error" in checkNumberResult) {
      return NextResponse.json({ error: checkNumberResult.error }, { status: 400 });
    }

    const cleanMemo = memo && typeof memo === "string" ? memo.trim() || null : null;

    // Amount + date are server-derived from the bank line — never client input
    const amountCents = Math.abs(bankLine.amountCents);
    if (amountCents <= 0) {
      return NextResponse.json(
        { error: "Cannot create a transaction from a zero-amount bank line" },
        { status: 400 },
      );
    }

    // Atomic: insert transaction + match row together
    const result = await db.transaction(async (tx) => {
      const [txn] = await tx
        .insert(ledgerTransactions)
        .values({
          entityId: reconSession.entityId,
          fundId,
          bankAccountId: reconSession.bankAccountId,
          txnDate: bankLine.postingDate,
          flow,
          categoryId: categoryId ?? null,
          amountCents,
          party: cleanParty,
          memo: cleanMemo,
          paymentMethod: paymentMethod ?? null,
          checkNumber: checkNumberResult.value,
          status: "posted",
          recordedByUserId: authSession.user.id,
        })
        .returning({ id: ledgerTransactions.id });

      const [match] = await tx
        .insert(ledgerReconciliationMatches)
        .values({
          sessionId,
          bankLineId,
          transactionId: txn.id,
          createdByUserId: authSession.user.id,
        })
        .returning({ id: ledgerReconciliationMatches.id });

      return { transactionId: txn.id, matchId: match.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error creating transaction from bank line:", error);
    return NextResponse.json(
      { error: "Failed to create transaction from bank line" },
      { status: 500 },
    );
  }
}
