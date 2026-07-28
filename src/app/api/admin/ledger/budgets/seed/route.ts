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
 *   seedCauseLines?: boolean;              // optional, default false (B-17 Increment A,
 *                                          // DECISION-045/046) — see below.
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
 *     causeBreakdownSkippedCount: number;   // count of lines skipped via 'skipped_cause_breakdown' below
 *     lines: Array<{
 *       categoryId: string;
 *       categoryName: string;
 *       flow: 'income' | 'expense';
 *       amountCents: number;
 *       source: 'actual' | 'prior_budget';
 *       action: 'seeded' | 'skipped_existing' | 'overwritten' | 'skipped_cause_breakdown';
 *         // 'skipped_cause_breakdown' (regression fix, qa Phase 5 FAIL 2026-07-27): this
 *         // category already has ledger_budget_lines children — its lump-sum amount is
 *         // deliberately left untouched by this top-level loop rather than clobbered.
 *         // Distinct from 'skipped_existing' (an ordinary fill-empty collision) so the UI
 *         // can give it accurate copy. Its own cause-line-seeding pass (causeLines below,
 *         // when seedCauseLines is true) is the correct path that may still update it.
 *       causeLines?: Array<{               // present only when seedCauseLines was true
 *         cause: string;                   // AND this is an expense line whose category is
 *         amountCents: number;             // cause-eligible (flow==='expense' &&
 *         sourceFiscalYear: number;        // countsAsGiving===true) — see
 *         action: 'seeded' | 'skipped_existing' | 'overwritten';  // computeCauseSeedForCategory.
 *       }>;
 *     }>;
 *   }>;
 * }
 *
 * Cause-line seeding (seedCauseLines: true): for every expense line above
 * whose category is cause-eligible (flow==='expense' && category.countsAsGiving
 * === true — DECISION-046 item 4), computeCauseSeedForCategory() proposes
 * cause-tagged line items from the past two lookback FYs' posted actuals
 * (most-recent-FY tie-break, union across years — src/lib/ledger.ts
 * deriveCauseSeedLines()), and each proposed line is written via the SAME
 * decideSeedWriteAction(mode, collision) dispatch already used for the
 * top-level lines, inside the SAME db.transaction() as everything else — a
 * lock rejection anywhere rolls back the whole request atomically, exactly
 * like today's SeedLockedError pattern. A category with zero cause-tagged
 * actuals in the lookback window gets `causeLines: []`, never an error
 * (Human Answer 3's graceful-empty-state requirement — production's Quicken
 * import may not be seeded yet). NOTE: only categories that already have a
 * top-level `lines[]` entry (i.e. had actuals or a prior budget in the
 * immediate prior FY) get cause-line seeding in this pass — a category with
 * cause-tagged history in the older lookback FY only, but nothing in the
 * immediate prior FY, is not proposed here; add its cause lines manually via
 * PATCH /budgets/cause-lines.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerCategories } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntityById,
  getFunds,
  computeSeedFromPriorYear,
  upsertBudgetLine,
  upsertBudgetCauseLineForSeed,
  computeCauseSeedForCategory,
} from "@/lib/ledger-queries";
import { decideSeedWriteAction } from "@/lib/ledger";

const VALID_MODES = ["fill-empty", "overwrite"] as const;

// Thrown inside the db.transaction() below to force a rollback when
// upsertBudgetLine rejects a line for a reason that must abort the WHOLE
// request (a locked budget — writeResult.reason === "locked"; any future
// reason not explicitly handled below falls through to this same
// rollback-everything behavior, the safe default). A cause-broken-down
// category (writeResult.reason === "has_cause_breakdown") is handled
// separately, inline in the loop below — it's a per-category skip, not a
// whole-request abort. See the try/catch around the transaction call for how
// this maps back to an HTTP response.
class SeedLockedError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SeedLockedError";
    this.status = status;
  }
}

type CauseLineResponse = {
  cause: string;
  amountCents: number;
  sourceFiscalYear: number;
  action: "seeded" | "skipped_existing" | "overwritten";
};

type ResponseLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  amountCents: number;
  source: "actual" | "prior_budget";
  // "skipped_cause_breakdown" (regression fix, qa Phase 5 FAIL 2026-07-27):
  // this category already has ledger_budget_lines children (it's been
  // broken down by cause) — its lump-sum amount is deliberately left
  // untouched rather than clobbered by this top-level loop. Distinct from
  // "skipped_existing" (collision with an existing lump-sum target) so the
  // UI can give it accurate copy instead of "already set".
  action: "seeded" | "skipped_existing" | "overwritten" | "skipped_cause_breakdown";
  causeLines?: CauseLineResponse[];
};

type ResponseFund = {
  fundId: string;
  fundSlug: string;
  fundName: string;
  seededCount: number;
  skippedCount: number;
  overwrittenCount: number;
  // Count of top-level lines skipped specifically because the category is
  // already broken down by cause (see ResponseLine.action above) — kept
  // separate from skippedCount so existing "N already set" copy stays
  // accurate for the pre-existing collision-skip case.
  causeBreakdownSkippedCount: number;
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
    const { entityId, targetFiscalYear, mode, fundIds, seedCauseLines } = body;

    if (seedCauseLines !== undefined && typeof seedCauseLines !== "boolean") {
      return NextResponse.json({ error: "seedCauseLines must be a boolean" }, { status: 400 });
    }
    const shouldSeedCauseLines = seedCauseLines === true;

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
        let causeBreakdownSkippedCount = 0;
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

          if (!writeResult.ok) {
            // "has_cause_breakdown" (regression fix, qa Phase 5 FAIL
            // 2026-07-27): this category already has ledger_budget_lines
            // children — upsertBudgetLine correctly refused to clobber its
            // parent total from this lump-sum path. This is a per-category
            // skip, NOT a reason to abort the whole seed request: the
            // category's existing cause breakdown is left exactly as-is
            // (its own cause-line-seeding pass below, if seedCauseLines was
            // requested, is what may legitimately update it).
            if (writeResult.reason === "has_cause_breakdown") {
              causeBreakdownSkippedCount++;
              lines.push({
                categoryId: line.categoryId,
                categoryName: line.categoryName,
                flow: line.flow,
                amountCents: line.proposedAmountCents,
                source: line.source,
                action: "skipped_cause_breakdown",
              });
              continue;
            }

            // Any other rejection (currently just "locked", from
            // assertBudgetUnlocked) must abort the whole request. Discarding
            // this result would silently report a fake 200 with
            // seededCount/overwrittenCount numbers while zero rows were
            // actually written for a locked FY. Throw so db.transaction()
            // rolls back the whole seed atomically — no partial-seed-then-
            // reject state — and surface the 409 to the caller via the
            // outer catch block below.
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

        // Cause-line seeding (B-17 Increment A, DECISION-045/046) — only for
        // funds whose kind is cause-eligible (activity/charitable), and only
        // for expense lines whose category itself is cause-eligible
        // (countsAsGiving === true). Reuses the SAME transaction (`tx`) and
        // the SAME mode/decideSeedWriteAction dispatch as the top-level
        // lines above — a lock rejection here rolls back the whole request
        // exactly like a lock rejection in the top-level loop.
        if (
          shouldSeedCauseLines &&
          (fundPreview.fund.kind === "activity" || fundPreview.fund.kind === "charitable")
        ) {
          const expenseCategoryIds = lines
            .filter((l) => l.flow === "expense")
            .map((l) => l.categoryId);

          const eligibleCategoryIds = new Set<string>();
          if (expenseCategoryIds.length > 0) {
            const eligibleCats = await tx
              .select({ id: ledgerCategories.id })
              .from(ledgerCategories)
              .where(
                and(
                  eq(ledgerCategories.entityId, entity.id),
                  eq(ledgerCategories.fundKind, fundPreview.fund.kind),
                  eq(ledgerCategories.flow, "expense"),
                  eq(ledgerCategories.countsAsGiving, true),
                ),
              );
            for (const cat of eligibleCats) eligibleCategoryIds.add(cat.id);
          }

          for (const line of lines) {
            if (line.flow !== "expense" || !eligibleCategoryIds.has(line.categoryId)) {
              continue;
            }

            const proposedCauseLines = await computeCauseSeedForCategory(
              fundPreview.fund.id,
              line.categoryId,
              targetFiscalYear,
              tx,
            );

            const causeLines: CauseLineResponse[] = [];
            for (const proposed of proposedCauseLines) {
              const causeWriteAction = decideSeedWriteAction(mode, proposed.collision);

              if (causeWriteAction === "skip") {
                causeLines.push({
                  cause: proposed.cause,
                  amountCents: proposed.amountCents,
                  sourceFiscalYear: proposed.sourceFiscalYear,
                  action: "skipped_existing",
                });
                continue;
              }

              const causeWriteResult = await upsertBudgetCauseLineForSeed(
                {
                  fundId: fundPreview.fund.id,
                  fiscalYear: targetFiscalYear,
                  categoryId: line.categoryId,
                  flow: "expense",
                  cause: proposed.cause,
                  amountCents: proposed.amountCents,
                },
                tx,
              );

              // Same rollback contract as the top-level line writes above —
              // throw so db.transaction() rolls back the whole seed
              // atomically on a lock rejection.
              if (!causeWriteResult.ok) {
                throw new SeedLockedError(causeWriteResult.error, causeWriteResult.status);
              }

              causeLines.push({
                cause: proposed.cause,
                amountCents: proposed.amountCents,
                sourceFiscalYear: proposed.sourceFiscalYear,
                action: causeWriteAction === "seed" ? "seeded" : "overwritten",
              });
            }

            line.causeLines = causeLines;
          }
        }

        responseFunds.push({
          fundId: fundPreview.fund.id,
          fundSlug: fundPreview.fund.slug,
          fundName: fundPreview.fund.name,
          seededCount,
          skippedCount,
          overwrittenCount,
          causeBreakdownSkippedCount,
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
