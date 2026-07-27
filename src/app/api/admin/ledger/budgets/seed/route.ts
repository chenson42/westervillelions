/**
 * POST /api/admin/ledger/budgets/seed
 *
 * Guided Budgeting — seeds next year's budget from prior-year actuals (or
 * prior-year budget, per the fund-wide fallback) for one or more funds of an
 * entity. Gate: LEDGER_MANAGE.
 *
 * Never trusts client-supplied amounts: the proposed lines are recomputed
 * fresh, server-side, inside this request (computeSeedFromPriorYear), then
 * written atomically inside a single db.transaction() — closing the race
 * between whatever the page rendered a moment ago and this click.
 *
 * Body:
 * {
 *   entityId: string;
 *   targetFiscalYear: number;              // integer, 2000-2100
 *   mode: 'fill-empty' | 'overwrite';      // required, no default
 *   fundIds?: string[];                    // optional subset of entityId's active funds.
 *                                          // Omitted/empty -> all active funds of entityId.
 * }
 *
 * Response 200:
 * {
 *   priorFiscalYear: number;
 *   targetFiscalYear: number;
 *   funds: Array<{
 *     fundId: string;
 *     fundSlug: string;
 *     fundName: string;
 *     seededCount: number;
 *     skippedCount: number;
 *     overwrittenCount: number;
 *     lines: Array<{
 *       categoryId: string;
 *       categoryName: string;
 *       flow: 'income' | 'expense';
 *       amountCents: number;
 *       source: 'actual' | 'prior_budget';
 *       action: 'seeded' | 'skipped_existing' | 'overwritten';
 *     }>;
 *   }>;
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntityById,
  getFunds,
  computeSeedFromPriorYear,
  upsertBudgetLine,
} from "@/lib/ledger-queries";
import { decideSeedWriteAction } from "@/lib/ledger";

const VALID_MODES = ["fill-empty", "overwrite"] as const;

// Thrown inside the db.transaction() below to force a rollback when
// upsertBudgetLine rejects a line (currently only the lock check, but any
// future non-ok result from upsertBudgetLine is handled the same way) — see
// the try/catch around the transaction call for how this maps back to an
// HTTP response.
class SeedLockedError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SeedLockedError";
    this.status = status;
  }
}

type ResponseLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  amountCents: number;
  source: "actual" | "prior_budget";
  action: "seeded" | "skipped_existing" | "overwritten";
};

type ResponseFund = {
  fundId: string;
  fundSlug: string;
  fundName: string;
  seededCount: number;
  skippedCount: number;
  overwrittenCount: number;
  lines: ResponseLine[];
};

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { entityId, targetFiscalYear, mode, fundIds } = body;

    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    if (
      targetFiscalYear === undefined ||
      typeof targetFiscalYear !== "number" ||
      !Number.isInteger(targetFiscalYear) ||
      targetFiscalYear < 2000 ||
      targetFiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "targetFiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }
    if (!mode || !(VALID_MODES as readonly string[]).includes(mode)) {
      return NextResponse.json(
        { error: "mode must be 'fill-empty' or 'overwrite'" },
        { status: 400 },
      );
    }

    let scopedFundIds: string[] | undefined;
    if (fundIds !== undefined) {
      if (!Array.isArray(fundIds) || fundIds.some((id) => typeof id !== "string")) {
        return NextResponse.json(
          { error: "fundIds must be an array of strings" },
          { status: 400 },
        );
      }
      // Empty array is treated as "omitted" (all funds), not "zero funds" —
      // avoids a confusing 200-with-nothing-seeded response from an
      // accidental [].
      scopedFundIds = fundIds.length > 0 ? (fundIds as string[]) : undefined;
    }

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const entityFunds = await getFunds(entityId);
    if (scopedFundIds) {
      const entityFundIds = new Set(entityFunds.map((f) => f.id));
      for (const fundId of scopedFundIds) {
        if (!entityFundIds.has(fundId)) {
          return NextResponse.json(
            { error: `Fund ${fundId} does not belong to this entity` },
            { status: 400 },
          );
        }
      }
    }

    // Recomputed fresh, now, inside this request — never trusts whatever the
    // page rendered a moment ago.
    const preview = await computeSeedFromPriorYear(entityId, targetFiscalYear, scopedFundIds);

    const responseFunds: ResponseFund[] = [];

    await db.transaction(async (tx) => {
      for (const fundPreview of preview.funds) {
        let seededCount = 0;
        let skippedCount = 0;
        let overwrittenCount = 0;
        const lines: ResponseLine[] = [];

        for (const line of fundPreview.seedableLines) {
          const writeAction = decideSeedWriteAction(mode, line.collision);

          if (writeAction === "skip") {
            skippedCount++;
            lines.push({
              categoryId: line.categoryId,
              categoryName: line.categoryName,
              flow: line.flow,
              amountCents: line.proposedAmountCents,
              source: line.source,
              action: "skipped_existing",
            });
            continue;
          }

          // "seed" and "overwrite" both resolve to the same DB upsert — the
          // label in the response comes from decideSeedWriteAction's pre-write
          // collision check, not from inspecting what the upsert returned.
          const writeResult = await upsertBudgetLine(
            {
              fundId: fundPreview.fund.id,
              fiscalYear: targetFiscalYear,
              categoryId: line.categoryId,
              flow: line.flow,
              annualAmountCents: line.proposedAmountCents,
              conflictMode: "update",
            },
            tx,
          );

          // upsertBudgetLine now returns { ok: false, status: 409 } when the
          // target (entityId, fiscalYear) is locked (assertBudgetUnlocked,
          // called from inside upsertBudgetLine). Discarding this result
          // would silently report a fake 200 with seededCount/overwrittenCount
          // numbers while zero rows were actually written for a locked FY.
          // Throw so db.transaction() rolls back the whole seed atomically —
          // no partial-seed-then-reject state — and surface the 409 to the
          // caller via the outer catch block below.
          if (!writeResult.ok) {
            throw new SeedLockedError(writeResult.error, writeResult.status);
          }

          if (writeAction === "seed") {
            seededCount++;
          } else {
            overwrittenCount++;
          }
          lines.push({
            categoryId: line.categoryId,
            categoryName: line.categoryName,
            flow: line.flow,
            amountCents: line.proposedAmountCents,
            source: line.source,
            action: writeAction === "seed" ? "seeded" : "overwritten",
          });
        }

        responseFunds.push({
          fundId: fundPreview.fund.id,
          fundSlug: fundPreview.fund.slug,
          fundName: fundPreview.fund.name,
          seededCount,
          skippedCount,
          overwrittenCount,
          lines,
        });
      }
    });

    return NextResponse.json({
      priorFiscalYear: preview.priorFiscalYear,
      targetFiscalYear: preview.targetFiscalYear,
      funds: responseFunds,
    });
  } catch (error) {
    if (error instanceof SeedLockedError) {
      // db.transaction() has already rolled back — no rows from this seed
      // request were written, even for lines processed before the locked
      // one was hit.
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error seeding ledger budgets:", error);
    return NextResponse.json({ error: "Failed to seed budgets" }, { status: 500 });
  }
}
