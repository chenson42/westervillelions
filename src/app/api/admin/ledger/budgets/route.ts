/**
 * PATCH /api/admin/ledger/budgets
 *
 * Upsert or delete a budget line for a fund × fiscal year × category × flow.
 * Gate: LEDGER_MANAGE
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   annualAmountCents: number | null;
 *     // positive integer or 0 → upsert with that amount
 *     // null → delete the budget row (report shows "—" for that category)
 * }
 *
 * Response 200: { action: 'upserted' | 'deleted', id?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ledgerBudgets,
  ledgerFunds,
  ledgerCategories,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const INT4_MAX = 2_147_483_647;
const VALID_FLOWS = ["income", "expense"] as const;

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fundId, fiscalYear, categoryId, flow, annualAmountCents } = body;

    // Validate required fields
    if (!fundId || typeof fundId !== "string") {
      return NextResponse.json({ error: "fundId is required" }, { status: 400 });
    }
    if (!categoryId || typeof categoryId !== "string") {
      return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
    }
    if (
      fiscalYear === undefined ||
      typeof fiscalYear !== "number" ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 2000 ||
      fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }
    if (!flow || !(VALID_FLOWS as readonly string[]).includes(flow)) {
      return NextResponse.json(
        { error: "flow must be 'income' or 'expense'" },
        { status: 400 },
      );
    }

    // Validate fund exists
    const fundRows = await db
      .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
      .from(ledgerFunds)
      .where(eq(ledgerFunds.id, fundId))
      .limit(1);
    const fund = fundRows[0];
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    // Validate category exists and matches fund kind + flow
    const catRows = await db
      .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind, flow: ledgerCategories.flow })
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
        { error: "Category flow does not match the requested flow" },
        { status: 400 },
      );
    }

    // null annualAmountCents → delete the budget row
    if (annualAmountCents === null) {
      await db
        .delete(ledgerBudgets)
        .where(
          and(
            eq(ledgerBudgets.fundId, fundId),
            eq(ledgerBudgets.fiscalYear, fiscalYear),
            eq(ledgerBudgets.categoryId, categoryId),
            eq(ledgerBudgets.flow, flow),
          ),
        );
      return NextResponse.json({ action: "deleted" });
    }

    // Validate annualAmountCents
    if (
      typeof annualAmountCents !== "number" ||
      !Number.isInteger(annualAmountCents) ||
      annualAmountCents < 0
    ) {
      return NextResponse.json(
        { error: "annualAmountCents must be a non-negative integer, or null to remove the budget" },
        { status: 400 },
      );
    }
    if (annualAmountCents > INT4_MAX) {
      return NextResponse.json(
        { error: `annualAmountCents must not exceed ${INT4_MAX}` },
        { status: 400 },
      );
    }

    // Upsert on (fundId, fiscalYear, categoryId, flow)
    const [upserted] = await db
      .insert(ledgerBudgets)
      .values({
        entityId: fund.entityId,
        fundId,
        fiscalYear,
        categoryId,
        flow,
        annualAmountCents,
      })
      .onConflictDoUpdate({
        target: [
          ledgerBudgets.fundId,
          ledgerBudgets.fiscalYear,
          ledgerBudgets.categoryId,
          ledgerBudgets.flow,
        ],
        set: {
          annualAmountCents,
          updatedAt: new Date(),
        },
      })
      .returning({ id: ledgerBudgets.id });

    return NextResponse.json({ action: "upserted", id: upserted.id });
  } catch (error) {
    console.error("Error upserting ledger budget:", error);
    return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });
  }
}
