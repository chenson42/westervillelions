/**
 * GET /api/admin/ledger/categories
 *
 * Ledger Category Management (2026-08-07 / DECISION-065/066) — list+filter,
 * the read side of `/admin/ledger/settings/categories`.
 *
 * Gate: LEDGER_MANAGE
 *
 * Query params:
 *   entityId       required
 *   fundKind       optional — one of the 4 valid kinds
 *   flow           optional — 'income' | 'expense'
 *   includeInactive optional — "true" to include deactivated categories
 *                    (default: active only)
 *
 * Response 200: { categories: LedgerCategoryDTO[] }, ordered sortOrder, name.
 *
 * Errors: 400 missing/invalid entityId/fundKind/flow; 401; 403; 404 entity not found.
 */

/**
 * POST /api/admin/ledger/categories
 *
 * Guided Budgeting — creates a new ledger category inline, scoped to the fund
 * card the treasurer is looking at. This is the ONLY runtime category-
 * creation path in the app (categories were previously seed-only, via SQL
 * migrations) and it deliberately creates a REAL ledgerCategories row, not a
 * budget-only bucket — "budget buckets ARE ledger buckets" (Phase 3 design):
 * budget-vs-actual reporting (getFundReport) matches actuals to budget
 * targets by categoryId, so a bucket that only existed for budgeting could
 * never be compared against real spend.
 *
 * Gate: LEDGER_MANAGE or BUDGET_EDIT (BUDGET_WRITE_FEATURES, the same constant
 * the budgeting page's canManage and every budget route use — Y9,
 * DECISION-115: the page showed "+ Add category" to a budget.edit-only user
 * and this route refused them). The two fields that feed the philanthropy
 * dashboard and the Form 990 worksheet, countsAsGiving: false and a non-empty
 * form990Line, stay LEDGER_MANAGE-only: a caller without it who sends either
 * gets a plain-language 403 before any lookup. Omitted or countsAsGiving: true
 * (the dialog's default) is accepted. GET and the [id] / merge routes stay
 * LEDGER_MANAGE-only.
 *
 * Per DECISION-044, this endpoint never accepts an amount — the category is
 * created bare (no ledger_budgets row) and appears in BudgetEditor as an
 * empty-amount row; the treasurer's next keystroke goes through the existing
 * PATCH /budgets, unchanged. Category creation is NOT audited (DECISION-066
 * item 5) — unchanged from before this feature.
 *
 * Body:
 * {
 *   entityId: string;
 *   fiscalYear: number;        // integer 2000-2100; used ONLY for the lock
 *                              // check (assertBudgetUnlocked) — not persisted,
 *                              // ledgerCategories has no fiscalYear column.
 *   fundKind: 'administrative' | 'activity' | 'charitable' | 'scholarship';
 *   flow: 'income' | 'expense';
 *   name: string;              // required, trimmed, non-empty
 *   countsAsGiving?: boolean;  // default true (matches schema default)
 *   form990Line?: string;      // optional, trimmed
 * }
 *
 * Response 200:
 * { id, name, fundKind, flow, sortOrder, countsAsGiving, form990Line, isActive: true }
 *
 * Errors:
 *   400 — missing/invalid entityId/fiscalYear/fundKind/flow, fundKind doesn't
 *         match any active fund of that kind for the entity, or
 *         validateCategoryCreateInput rejects the name/flow.
 *   401 — not authenticated
 *   403 — forbidden (neither LEDGER_MANAGE nor BUDGET_EDIT, or a manage-only
 *         field sent without LEDGER_MANAGE); the message is plain language
 *   404 — entity not found
 *   409 — budget for (entityId, fiscalYear) is locked, or a case-insensitive
 *         duplicate name already exists for this (entityId, fundKind, flow).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerCategories } from "@/lib/db/schema";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { BUDGET_WRITE_FEATURES, FEATURES } from "@/lib/permissions";
import { getEntityById, getFunds, getCategories, assertBudgetUnlocked } from "@/lib/ledger-queries";
import { listCategoriesForAdmin, toCategoryDTO } from "@/lib/ledger-category-queries";
import { validateCategoryCreateInput, nextCategorySortOrder } from "@/lib/ledger";

const VALID_FUND_KINDS = ["administrative", "activity", "charitable", "scholarship"] as const;
const VALID_FLOWS = ["income", "expense"] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");
    const fundKind = searchParams.get("fundKind") ?? undefined;
    const flow = searchParams.get("flow") ?? undefined;
    const includeInactive = searchParams.get("includeInactive") === "true";

    if (!entityId) {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    if (fundKind && !(VALID_FUND_KINDS as readonly string[]).includes(fundKind)) {
      return NextResponse.json(
        { error: "fundKind must be one of administrative, activity, charitable, scholarship" },
        { status: 400 },
      );
    }
    if (flow && !(VALID_FLOWS as readonly string[]).includes(flow)) {
      return NextResponse.json({ error: "flow must be 'income' or 'expense'" }, { status: 400 });
    }

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const categories = await listCategoriesForAdmin(entityId, { fundKind, flow, includeInactive });

    return NextResponse.json({ categories: categories.map(toCategoryDTO) });
  } catch (error) {
    console.error("Error listing ledger categories:", error);
    return NextResponse.json({ error: "Failed to list categories" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasAnyFeature(session.user.id, BUDGET_WRITE_FEATURES))) {
      return NextResponse.json(
        { error: "You need Budget edit or Ledger management access to add a category." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { entityId, fiscalYear, fundKind, flow, name, countsAsGiving, form990Line } = body;

    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
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
    if (!fundKind || !(VALID_FUND_KINDS as readonly string[]).includes(fundKind)) {
      return NextResponse.json(
        { error: "fundKind must be one of administrative, activity, charitable, scholarship" },
        { status: 400 },
      );
    }
    if (!flow || !(VALID_FLOWS as readonly string[]).includes(flow)) {
      return NextResponse.json({ error: "flow must be 'income' or 'expense'" }, { status: 400 });
    }
    if (
      countsAsGiving !== undefined &&
      typeof countsAsGiving !== "boolean"
    ) {
      return NextResponse.json({ error: "countsAsGiving must be a boolean" }, { status: 400 });
    }
    if (form990Line !== undefined && form990Line !== null && typeof form990Line !== "string") {
      return NextResponse.json({ error: "form990Line must be a string" }, { status: 400 });
    }

    // Manage-only fields (DECISION-115 ruling 6): only a DEVIATION from the
    // defaults needs ledger.manage, because the Guided Budgeting dialog always
    // sends countsAsGiving (default true). Checked before any DB lookup.
    const setsManageOnlyField =
      countsAsGiving === false || (typeof form990Line === "string" && form990Line.trim() !== "");
    if (setsManageOnlyField && !(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json(
        {
          error:
            "Setting 'counts as giving' to off, or a Form 990 line, needs ledger management access. Add the category with the defaults and ask the treasurer to adjust it.",
        },
        { status: 403 },
      );
    }

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // fundKind must correspond to a real, active fund for this entity — the
    // UI only ever offers the kind of the fund card the treasurer is looking
    // at, so a mismatched kind here means a stale/forged request.
    const entityFunds = await getFunds(entityId);
    if (!entityFunds.some((f) => f.kind === fundKind)) {
      return NextResponse.json(
        { error: `No active fund of kind '${fundKind}' exists for this entity` },
        { status: 400 },
      );
    }

    const lock = await assertBudgetUnlocked(entityId, fiscalYear);
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status });
    }

    const existing = await getCategories(entityId, { fundKind, flow });

    const validation = validateCategoryCreateInput({
      name: typeof name === "string" ? name : "",
      flow,
      existingNames: existing.map((c) => c.name),
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const sortOrder = nextCategorySortOrder(existing.map((c) => c.sortOrder));
    const trimmedName = name.trim();
    const trimmedForm990Line =
      typeof form990Line === "string" && form990Line.trim() ? form990Line.trim() : null;

    const inserted = await db
      .insert(ledgerCategories)
      .values({
        entityId,
        fundKind,
        flow,
        name: trimmedName,
        sortOrder,
        countsAsGiving: countsAsGiving ?? true,
        form990Line: trimmedForm990Line,
        isActive: true,
      })
      .returning();

    const category = inserted[0];

    return NextResponse.json({
      id: category.id,
      name: category.name,
      fundKind: category.fundKind,
      flow: category.flow,
      sortOrder: category.sortOrder,
      countsAsGiving: category.countsAsGiving,
      form990Line: category.form990Line,
      isActive: category.isActive,
    });
  } catch (error) {
    console.error("Error creating ledger category:", error);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
