import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  getFunds,
  getFundReport,
  getCategories,
  getBudgetApproval,
  getBudgetCauseLineLabels,
} from "@/lib/ledger-queries";
import { isBudgetLocked, causeLineReferenceKey } from "@/lib/ledger";
import { fiscalYearLabel, currentFiscalYear } from "@/lib/fiscal-year";
import LoadErrorCard from "@/components/admin/ledger/load-error-card";
import BudgetFundEditor, { type FundSetupItem } from "@/components/admin/ledger/budget-fund-editor";

export const dynamic = "force-dynamic";

/**
 * Single-fund budget drill-down (Budgeting Overview/Drill-Down Restructure)
 * — mirrors src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx's own
 * conventions one level deeper: own auth() + any-of gate (not a shared
 * layout-level check), entity-fallback on an invalid ?entity=, notFound() on
 * an invalid fundSlug for the resolved entity, ?entity=&fy= preserved on the
 * "back to overview" breadcrumb.
 */
export default async function AdminLedgerBudgetingFundPage({
  params,
  searchParams,
}: {
  params: Promise<{ fundSlug: string }>;
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canAccess = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_MANAGE,
    FEATURES.LEDGER_APPROVE,
    FEATURES.BUDGET_VIEW,
    FEATURES.BUDGET_EDIT,
  ]);
  if (!canAccess) redirect("/access-pending");

  const canManage = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_MANAGE,
    FEATURES.BUDGET_EDIT,
  ]);

  const { fundSlug } = await params;
  const { entity: entityParam, fy: fyParam } = await searchParams;

  let entities;
  try {
    entities = await getEntities();
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  const validSlugs = entities.map((e) => e.slug);
  const resolvedEntitySlug =
    entityParam && validSlugs.includes(entityParam) ? entityParam : entities[0].slug;

  let entity;
  try {
    entity = await getEntity(resolvedEntitySlug);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }
  if (!entity) notFound();

  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const targetFY = !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;
  const priorFY = targetFY - 1;
  const overviewHref = `/admin/ledger/budgeting?entity=${resolvedEntitySlug}&fy=${targetFY}`;

  let funds;
  try {
    funds = await getFunds(entity.id);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }
  const fund = funds.find((f) => f.slug === fundSlug);
  if (!fund) notFound();

  let approval;
  try {
    approval = await getBudgetApproval(entity.id, targetFY);
  } catch {
    return <LoadErrorCard backHref={overviewHref} />;
  }
  const locked = isBudgetLocked(approval);

  let targetReport, priorReport, labelOptions;
  try {
    [targetReport, priorReport, labelOptions] = await Promise.all([
      getFundReport(fund.id, targetFY),
      getFundReport(fund.id, priorFY),
      getBudgetCauseLineLabels(entity.id),
    ]);
  } catch {
    return <LoadErrorCard backHref={overviewHref} />;
  }

  // "+ Add category" needs this ONE fund's active-but-not-yet-a-line
  // categories per flow — only fetched when it can actually be used
  // (canManage, unlocked), and only for the drilled-into fund (moved off the
  // overview entirely, architect Ruling 2).
  const priorByKey = new Map<string, { budgetCents: number | null; actualCents: number }>();
  for (const l of priorReport?.income ?? []) {
    priorByKey.set(`${l.categoryId}_income`, { budgetCents: l.budgetCents, actualCents: l.actualCents });
  }
  for (const l of priorReport?.expense ?? []) {
    priorByKey.set(`${l.categoryId}_expense`, { budgetCents: l.budgetCents, actualCents: l.actualCents });
  }

  const priorCauseBudgetByKey = new Map<string, number>();
  for (const l of [...(priorReport?.income ?? []), ...(priorReport?.expense ?? [])]) {
    for (const cl of l.causeLines ?? []) {
      priorCauseBudgetByKey.set(
        causeLineReferenceKey(l.categoryId, cl.cause, cl.label),
        cl.amountCents,
      );
    }
  }
  const priorCauseActualsByKey = priorReport?.causeActualsByKey ?? {};

  function enrichCauseLines(
    categoryId: string,
    causeLines:
      | {
          id: string;
          cause: string;
          label: string;
          amountCents: number;
          pendingDeleteAt: string | null;
          starred: boolean;
          note: string | null;
        }[]
      | null,
  ) {
    if (!causeLines) return null;
    return causeLines.map((cl) => {
      const key = causeLineReferenceKey(categoryId, cl.cause, cl.label);
      return {
        ...cl,
        priorBudgetCents: priorCauseBudgetByKey.get(key) ?? null,
        priorActualCents: priorCauseActualsByKey[key] ?? null,
      };
    });
  }

  const budgetEditorLines = [
    ...(targetReport?.income ?? []).map((l) => ({
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      flow: "income" as const,
      budgetCents: l.budgetCents,
      countsAsGiving: l.countsAsGiving,
      causeLines: enrichCauseLines(l.categoryId, l.causeLines),
      priorBudgetCents: priorByKey.get(`${l.categoryId}_income`)?.budgetCents ?? null,
      priorActualCents: priorByKey.get(`${l.categoryId}_income`)?.actualCents ?? null,
      pendingDeleteAt: l.pendingDeleteAt,
      starred: l.starred,
      note: l.note,
    })),
    ...(targetReport?.expense ?? []).map((l) => ({
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      flow: "expense" as const,
      budgetCents: l.budgetCents,
      countsAsGiving: l.countsAsGiving,
      causeLines: enrichCauseLines(l.categoryId, l.causeLines),
      priorBudgetCents: priorByKey.get(`${l.categoryId}_expense`)?.budgetCents ?? null,
      priorActualCents: priorByKey.get(`${l.categoryId}_expense`)?.actualCents ?? null,
      pendingDeleteAt: l.pendingDeleteAt,
      starred: l.starred,
      note: l.note,
    })),
  ];

  let unbudgetedCategories: FundSetupItem["unbudgetedCategories"] = { income: [], expense: [] };
  if (canManage && !locked) {
    let incomeCats, expenseCats;
    try {
      [incomeCats, expenseCats] = await Promise.all([
        getCategories(entity.id, { fundKind: fund.kind, flow: "income" }),
        getCategories(entity.id, { fundKind: fund.kind, flow: "expense" }),
      ]);
    } catch {
      return <LoadErrorCard backHref={overviewHref} />;
    }
    const budgetedKeys = new Set(budgetEditorLines.map((l) => `${l.categoryId}_${l.flow}`));
    unbudgetedCategories = {
      income: incomeCats
        .filter((c) => !budgetedKeys.has(`${c.id}_income`))
        .map((c) => ({ id: c.id, name: c.name })),
      expense: expenseCats
        .filter((c) => !budgetedKeys.has(`${c.id}_expense`))
        .map((c) => ({ id: c.id, name: c.name })),
    };
  }

  const fundItem: FundSetupItem = {
    fundId: fund.id,
    fundSlug: fund.slug,
    fundName: fund.name,
    fundKind: fund.kind,
    budgetEditorLines,
    unbudgetedCategories,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={overviewHref}
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Budget Overview
        </Link>
      </div>

      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          Treasury &middot; Budgeting
        </p>
        <h1 className="text-3xl font-bold text-gray-900">{fund.name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {entity.shortName ?? entity.name} &bull; {fiscalYearLabel(targetFY)} budget &bull; prior
          year reference: {fiscalYearLabel(priorFY)}
        </p>
      </div>

      <BudgetFundEditor
        entityId={entity.id}
        targetFiscalYear={targetFY}
        fund={fundItem}
        canManage={canManage}
        locked={locked}
        labelOptions={labelOptions}
        overviewHref={overviewHref}
      />
    </div>
  );
}
