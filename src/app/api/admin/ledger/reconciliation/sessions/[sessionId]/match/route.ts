/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match
 *
 * Matches one staged bank line to a SET of one or more existing posted
 * transactions whose signed amounts sum exactly to the bank line's own
 * signed amount — a general many-to-one match (income or expense
 * transactions alike), with Zeffy's weekly dues batch as the worked example,
 * not a Zeffy-specific mechanism (DECISION-051). A 1-element array is the
 * degenerate single-match case — same code path, no separate "batch" mode.
 * Does NOT touch `reconciled`/`reconciledAt` — those flip only at session
 * close, in a batch (architect's Ruling 3).
 *
 * Gate: LEDGER_RECORD
 *
 * Body: { bankLineId: string; transactionIds: string[] }  (array-only, min
 *        length 1 — the request body's former singular `transactionId`
 *        field is removed, not kept as an alias; this route's one caller,
 *        reconciliation-match-picker.tsx, sends `transactionIds: [id]` for a
 *        plain single pick.)
 * Response 201: { bankLineId, matchIds: string[], transactionIds: string[], count }
 *
 * Errors:
 *   400 — malformed body; a transaction is not posted or belongs to a
 *         different bank account; selected transactions don't sum to the
 *         bank line's amount (deltaCents included)
 *   404 — session, bank line, or one/more transactions not found
 *   409 — session not open; bank line already matched; a transaction is
 *         already reconciled or already matched to a different bank line;
 *         or a race lost to a concurrent match on one of the selected ids
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerReconciliationMatches } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getBankLineById,
  getMatchForBankLine,
  getTransactionsByIds,
  getMatchesForTransactionIds,
} from "@/lib/reconciliation-queries";

/**
 * Extracts a Postgres error code from a thrown value, unwrapping Drizzle's
 * `.cause` wrapping when present. Mirrors the pattern in
 * src/app/api/admin/ledger/filings/route.ts — translates a unique-constraint
 * race (23505) into a clean 409 instead of a generic 500.
 */
function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: string }).code;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    typeof (err as { cause?: unknown }).cause === "object" &&
    (err as { cause?: unknown }).cause !== null &&
    "code" in (err as { cause: object }).cause
  ) {
    return (err as { cause: { code?: string } }).cause.code;
  }
  return undefined;
}

/** Signed per the same convention the match picker already displays
 *  (`signedAmount()` in reconciliation-match-picker.tsx): expense
 *  contributes negative, income positive — so a debit bank line's negative
 *  `amountCents` sums correctly against a set of expense rows, and a credit
 *  line against income rows. */
function signedAmountCents(t: { flow: string; amountCents: number }): number {
  return t.flow === "expense" ? -t.amountCents : t.amountCents;
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
    const { bankLineId, transactionIds } = body ?? {};

    // Step 2: parse/validate body shape.
    if (!bankLineId || typeof bankLineId !== "string") {
      return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
    }
    if (
      !Array.isArray(transactionIds) ||
      transactionIds.length === 0 ||
      !transactionIds.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "transactionIds must be a non-empty array of distinct strings" },
        { status: 400 },
      );
    }
    const dedupedTransactionIds = Array.from(new Set(transactionIds as string[]));
    if (dedupedTransactionIds.length !== transactionIds.length) {
      return NextResponse.json(
        { error: "transactionIds must be a non-empty array of distinct strings" },
        { status: 400 },
      );
    }

    // Step 3: session must exist and be open.
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json(
        { error: "Reopen this session before changing matches" },
        { status: 409 },
      );
    }

    // Step 4: bank line belongs to this session.
    const bankLine = await getBankLineById(sessionId, bankLineId);
    if (!bankLine) {
      return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
    }

    // Step 5: bank line has no existing match at all — a bank line is
    // matched once, as a complete set, never incrementally appended to
    // (architect §4). Unchanged semantics from the single-match route.
    const existingBankLineMatch = await getMatchForBankLine(bankLineId);
    if (existingBankLineMatch) {
      return NextResponse.json(
        { error: "This bank line is already matched — unmatch it first" },
        { status: 409 },
      );
    }

    // Step 6: bulk-fetch every submitted transaction in ONE query, validate each.
    const fetchedTransactions = await getTransactionsByIds(dedupedTransactionIds);
    const fetchedById = new Map(fetchedTransactions.map((t) => [t.id, t]));

    const missingTransactionIds = dedupedTransactionIds.filter((id) => !fetchedById.has(id));
    if (missingTransactionIds.length > 0) {
      return NextResponse.json(
        { error: "One or more transactions were not found", missingTransactionIds },
        { status: 404 },
      );
    }

    const notPostedIds = dedupedTransactionIds.filter(
      (id) => fetchedById.get(id)!.status !== "posted",
    );
    if (notPostedIds.length > 0) {
      return NextResponse.json(
        {
          error: "Only posted transactions can be matched",
          invalidTransactionIds: notPostedIds,
        },
        { status: 400 },
      );
    }

    const wrongAccountIds = dedupedTransactionIds.filter(
      (id) => fetchedById.get(id)!.bankAccountId !== reconSession.bankAccountId,
    );
    if (wrongAccountIds.length > 0) {
      return NextResponse.json(
        {
          error: "One or more transactions do not belong to this session's bank account",
          invalidTransactionIds: wrongAccountIds,
        },
        { status: 400 },
      );
    }

    const alreadyReconciledIds = dedupedTransactionIds.filter(
      (id) => fetchedById.get(id)!.reconciled,
    );
    if (alreadyReconciledIds.length > 0) {
      return NextResponse.json(
        {
          error: "One or more transactions are already reconciled",
          invalidTransactionIds: alreadyReconciledIds,
        },
        { status: 409 },
      );
    }

    // Step 7: bulk-check none of the submitted transactions are already
    // matched (in any session) — step 5 already proved the TARGET line has
    // zero matches, so a hit here can only mean "matched elsewhere."
    const conflictingTransactionIds = await getMatchesForTransactionIds(dedupedTransactionIds);
    if (conflictingTransactionIds.length > 0) {
      return NextResponse.json(
        {
          error: "One or more transactions are already matched to a different bank line",
          conflictingTransactionIds,
        },
        { status: 409 },
      );
    }

    // Step 8: exact-sum re-check, server-fetched amounts only — never trust
    // the client's live running-sum indicator.
    const selectedSumCents = dedupedTransactionIds.reduce(
      (sum, id) => sum + signedAmountCents(fetchedById.get(id)!),
      0,
    );
    const bankLineAmountCents = bankLine.amountCents;
    if (selectedSumCents !== bankLineAmountCents) {
      return NextResponse.json(
        {
          error: "Selected transactions do not sum to the bank line amount",
          selectedSumCents,
          bankLineAmountCents,
          deltaCents: bankLineAmountCents - selectedSumCents,
        },
        { status: 400 },
      );
    }

    // Step 9: atomic insert — one db.transaction() inserting all N match
    // rows. transactionId is UNIQUE forever (DECISION-036); a race where a
    // concurrent request matches one of these ids between step 7 and here
    // surfaces as Postgres 23505, mapped to a clean 409.
    try {
      const inserted = await db.transaction(async (tx) => {
        return tx
          .insert(ledgerReconciliationMatches)
          .values(
            dedupedTransactionIds.map((transactionId) => ({
              sessionId,
              bankLineId,
              transactionId,
              createdByUserId: authSession.user.id,
            })),
          )
          .returning({ id: ledgerReconciliationMatches.id, transactionId: ledgerReconciliationMatches.transactionId });
      });

      return NextResponse.json(
        {
          bankLineId,
          matchIds: inserted.map((r) => r.id),
          transactionIds: inserted.map((r) => r.transactionId),
          count: inserted.length,
        },
        { status: 201 },
      );
    } catch (err: unknown) {
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json(
          {
            error:
              "One or more selected transactions were just matched elsewhere — refresh and try again",
          },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("Error matching bank line:", error);
    return NextResponse.json({ error: "Failed to match bank line" }, { status: 500 });
  }
}
