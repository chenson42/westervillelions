/**
 * GET /api/admin/ledger/reconciliation/sessions
 *
 * Lists reconciliation sessions, newest statement period first. Powers the
 * `/admin/ledger/reconciliation` audit-trail/list page.
 *
 * Gate: LEDGER_VIEW
 *
 * Query params (all optional): entityId, bankAccountId, status ('open' | 'closed')
 * Response 200: { sessions: ReconciliationSessionListRow[] }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/admin/ledger/reconciliation/sessions
 *
 * Creates a new reconciliation session for a bank account + statement period.
 * Cash-type accounts (Petty Cash, T-20) are rejected server-side — there is no
 * bank statement to tie out. Overlapping periods on the same account (ANY
 * status) are a HARD block (409); a gap since the account's most recent
 * session is a non-blocking warning in the 201 response body (historical
 * backlog periods are expected to be worked out of order — 2026-07-21 user
 * decision).
 *
 * Gate: LEDGER_RECORD
 *
 * Body:
 * {
 *   bankAccountId: string;
 *   statementPeriodStart: string;   // YYYY-MM-DD
 *   statementPeriodEnd: string;     // YYYY-MM-DD
 *   openingBalanceCents: number;
 *   closingBalanceCents: number;
 * }
 * Response 201: { id, bankAccountId, statementPeriodStart, statementPeriodEnd,
 *                 openingBalanceCents, closingBalanceCents, status, gapWarning?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerBankAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessions,
  getSessionPeriodsForAccount,
  createReconciliationSession,
} from "@/lib/reconciliation-queries";
import { validatePeriodOverlap, computePeriodGapWarning } from "@/lib/reconciliation";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2_147_483_647;
const VALID_STATUSES = ["open", "closed"] as const;

function isValidDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_REGEX.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d.getTime());
}

function isValidBalance(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= INT4_MAX
  );
}

/** "Jul 1–Jul 31, 2025" — human period label for overlap/gap/reopen error messages. */
function formatPeriodLabel(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const endYear = end.split("-")[0];
  return `${fmt(start)}–${fmt(end)}, ${endYear}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_VIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId") ?? undefined;
    const bankAccountId = searchParams.get("bankAccountId") ?? undefined;
    const status = searchParams.get("status") ?? undefined;

    if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: "status must be 'open' or 'closed'" },
        { status: 400 },
      );
    }

    const sessions = await getReconciliationSessions({ entityId, bankAccountId, status });
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error listing reconciliation sessions:", error);
    return NextResponse.json(
      { error: "Failed to list reconciliation sessions" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      bankAccountId,
      statementPeriodStart,
      statementPeriodEnd,
      openingBalanceCents,
      closingBalanceCents,
    } = body ?? {};

    if (!bankAccountId || typeof bankAccountId !== "string") {
      return NextResponse.json({ error: "bankAccountId is required" }, { status: 400 });
    }

    // 1. Account exists and is active
    const accountRows = await db
      .select({
        id: ledgerBankAccounts.id,
        accountType: ledgerBankAccounts.accountType,
        isActive: ledgerBankAccounts.isActive,
      })
      .from(ledgerBankAccounts)
      .where(eq(ledgerBankAccounts.id, bankAccountId))
      .limit(1);
    const account = accountRows[0];
    if (!account || !account.isActive) {
      return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    }

    // 2. Cash-type accounts (Petty Cash, T-20) excluded — no bank statement to tie out
    if (account.accountType === "cash") {
      return NextResponse.json(
        { error: "Cannot create a reconciliation session for a cash account" },
        { status: 400 },
      );
    }

    // 3/4. Period + balance shape validation
    if (!isValidDateString(statementPeriodStart) || !isValidDateString(statementPeriodEnd)) {
      return NextResponse.json(
        { error: "statementPeriodStart and statementPeriodEnd must be valid YYYY-MM-DD dates" },
        { status: 400 },
      );
    }
    if (statementPeriodStart > statementPeriodEnd) {
      return NextResponse.json(
        { error: "statementPeriodStart must be on or before statementPeriodEnd" },
        { status: 400 },
      );
    }
    if (!isValidBalance(openingBalanceCents) || !isValidBalance(closingBalanceCents)) {
      return NextResponse.json(
        { error: "openingBalanceCents and closingBalanceCents must be integers" },
        { status: 400 },
      );
    }

    // 5/6. Overlap (hard block) + gap (soft warning) against every existing
    // session (any status) for this account.
    const existingPeriods = await getSessionPeriodsForAccount(bankAccountId);

    const overlapResult = validatePeriodOverlap(
      { start: statementPeriodStart, end: statementPeriodEnd },
      existingPeriods,
    );
    if (overlapResult.overlap) {
      return NextResponse.json(
        {
          error: `This period overlaps an existing session (${formatPeriodLabel(
            overlapResult.conflictingPeriod.start,
            overlapResult.conflictingPeriod.end,
          )})`,
          conflictingSessionId: overlapResult.conflictingSessionId,
        },
        { status: 409 },
      );
    }

    const priorPeriodEnd = existingPeriods[0]?.end ?? null;
    const gapWarning = computePeriodGapWarning(statementPeriodStart, priorPeriodEnd);

    // 7. Insert
    const created = await createReconciliationSession({
      bankAccountId,
      statementPeriodStart,
      statementPeriodEnd,
      openingBalanceCents,
      closingBalanceCents,
    });

    return NextResponse.json(
      { ...created, gapWarning: gapWarning ?? undefined },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating reconciliation session:", error);
    return NextResponse.json(
      { error: "Failed to create reconciliation session" },
      { status: 500 },
    );
  }
}
