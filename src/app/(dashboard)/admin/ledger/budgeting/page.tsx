import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  getFunds,
  getFundReport,
  getBudgetApproval,
  getBudgetNotes,
} from "@/lib/ledger-queries";
import { isBudgetLocked, causeLineReferenceKey, computeFundPlanSums } from "@/lib/ledger";
import { isMonthGatedForEntity } from "@/lib/financial-report-queries";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import LoadErrorCard from "@/components/admin/ledger/load-error-card";
import BudgetOverviewTable, {
  type BudgetOverviewRow,
} from "@/components/admin/ledger/budget-overview-table";
import BudgetApprovalPanel, {
  type BudgetApprovalSummary,
} from "@/components/admin/ledger/budget-approval-panel";
import BudgetNotesEditor from "@/components/admin/ledger/budget-notes-editor";
import type { FundSetupItem } from "@/components/admin/ledger/budget-fund-editor";
import PrintBudgetButton from "@/components/admin/ledger/print-budget-button";
import BudgetPrintWorksheet from "@/components/admin/ledger/budget-print-worksheet";

export const dynamic = "force-dynamic";

function formatApprovalDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminLedgerBudgetingPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  // --- Auth: two-tier gate (unchanged from the pre-restructure page) — any
  // of LEDGER_MANAGE/LEDGER_APPROVE/BUDGET_VIEW/BUDGET_EDIT admits; canManage/
  // canApprove separately gate individual controls below.
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
  const canApprove = await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE);

  // --- Params ---
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
  // Unlike a permalink page, an invalid explicit ?entity= falls back to the
  // first entity rather than 404 — this is a setup tool, not a permalink
  // (unchanged from the pre-restructure page).
  const resolvedSlug =
    entityParam && validSlugs.includes(entityParam) ? entityParam : entities[0].slug;

  let entity;
  try {
    entity = await getEntity(resolvedSlug);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }
  if (!entity) notFound();

  // Default target FY is the CURRENT fiscal year — clubs budget the year they
  // are in. Planning a future year is still one click away via the
  // fiscal-year selector (?fy=).
  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const targetFY = !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;
  const priorFY = targetFY - 1;
  const fyOptions = [currentFY - 1, currentFY, currentFY + 1];
  const fyQuery = `?entity=${resolvedSlug}&fy=${targetFY}`;

  let funds;
  try {
    funds = await getFunds(entity.id);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }

  if (funds.length === 0) {
    return (
      <div className="space-y-6">
        <Breadcrumb entitySlug={resolvedSlug} />
        <PageHeader entity={entity} priorFY={priorFY} targetFY={targetFY} />
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No funds configured for this entity.</p>
          <p className="mt-1 text-sm">
            Set up funds in{" "}
            <Link
              href="/admin/ledger/settings"
              className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              Ledger Settings
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  // Lock state for (entity, targetFY) — the single source of truth shared
  // with every write-path guard (assertBudgetUnlocked). isBudgetLocked(null)
  // is false, so a never-approved FY renders unlocked by default.
  let approval;
  try {
    approval = await getBudgetApproval(entity.id, targetFY);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }
  const locked = isBudgetLocked(approval);
  const approvalSummary: BudgetApprovalSummary | null = approval
    ? {
        approvedByName: approval.approvedByName,
        approvedAtLabel: formatApprovalDate(approval.approvedAt),
        boardMinute: approval.boardMinute,
        unlockedByName: approval.unlockedByName,
        unlockedAtLabel: formatApprovalDate(approval.unlockedAt),
        unlockReason: approval.unlockReason,
      }
    : null;

  // Every fund's target-FY + prior-FY report, the budget-level notes row, and
  // the June-reconciliation-completeness flag (B-31's reconciliation
  // footnote) — one Promise.all, no serial round-trips. priorReports is still
  // needed here even though the on-screen summary rows don't render it: the
  // printed per-fund detail sections need the prior-year reference columns.
  let targetReports, priorReports, notesRow, juneNotReconciled;
  try {
    [targetReports, priorReports, notesRow, juneNotReconciled] = await Promise.all([
      Promise.all(funds.map((f) => getFundReport(f.id, targetFY))),
      Promise.all(funds.map((f) => getFundReport(f.id, priorFY))),
      getBudgetNotes(entity.id, targetFY),
      isMonthGatedForEntity(entity.id, `${targetFY}-06-30`),
    ]);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger/budgeting" />;
  }

  // fundItems: same construction as the pre-restructure page (still needed
  // in full — BudgetPrintWorksheet needs the full line/cause/star/note
  // detail per architect Ruling 2), EXCEPT unbudgetedCategories is now
  // ALWAYS empty here (the overview has no "+ Add category" affordance; that
  // fetch moves to the drill-down) and labelOptions is not fetched at all
  // (nothing on the overview renders BudgetCauseEditor's <datalist>).
  const fundItems: FundSetupItem[] = funds.map((fund, i) => {
    const report = targetReports[i];
    const priorReport = priorReports[i];

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
      ...(report?.income ?? []).map((l) => ({
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
      ...(report?.expense ?? []).map((l) => ({
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

    return {
      fundId: fund.id,
      fundSlug: fund.slug,
      fundName: fund.name,
      fundKind: fund.kind,
      budgetEditorLines,
      unbudgetedCategories: { income: [], expense: [] },
    };
  });

  // BudgetOverviewTable's rows, BudgetApprovalPanel's fundBalances, and
  // BudgetPrintWorksheet's openingCentsByFundId all derive from the SAME
  // fundItems/targetReports pair, via the SAME computeFundPlanSums call —
  // this is what makes "totals must match across the overview screen and
  // the printed document" true by construction (DECISION-060).
  const openingCentsByFundId: Record<string, number> = {};
  let totalPendingDeleteCount = 0;

  const overviewRows: BudgetOverviewRow[] = fundItems.map((fund, i) => {
    const openingCents = targetReports[i]?.openingCents ?? 0;
    openingCentsByFundId[fund.fundId] = openingCents;
    const sums = computeFundPlanSums(fund.budgetEditorLines);
    let pendingDeleteCount = 0;
    for (const line of fund.budgetEditorLines) {
      if (line.pendingDeleteAt !== null) pendingDeleteCount += 1;
      for (const cl of line.causeLines ?? []) {
        if (cl.pendingDeleteAt != null) pendingDeleteCount += 1;
      }
    }
    totalPendingDeleteCount += pendingDeleteCount;
    return {
      fundSlug: fund.fundSlug,
      fundName: fund.fundName,
      fundKind: fund.fundKind,
      openingCents,
      incomeCents: sums.incomeCents,
      expenseCents: sums.expenseCents,
      pendingDeleteCount,
    };
  });

  const fundBalances = overviewRows.map((row) => ({
    fundName: row.fundName,
    fundKind: row.fundKind,
    incomeCents: row.incomeCents,
    expenseCents: row.expenseCents,
  }));

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-6">
        <Breadcrumb entitySlug={resolvedSlug} />
        <PageHeader entity={entity} priorFY={priorFY} targetFY={targetFY} />

        {/* Entity switcher + target FY selector + print button */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <EntitySwitcher
              entities={entities}
              activeSlug={resolvedSlug}
              basePath="/admin/ledger/budgeting"
            />
            <FiscalYearSelector
              fiscalYears={fyOptions}
              currentFY={targetFY}
              basePath="/admin/ledger/budgeting"
            />
          </div>
          <PrintBudgetButton />
        </div>

        <BudgetApprovalPanel
          entityId={entity.id}
          targetFiscalYear={targetFY}
          canApprove={canApprove}
          locked={locked}
          approval={approvalSummary}
          pendingDeleteCount={totalPendingDeleteCount}
          fundBalances={fundBalances}
        />

        <BudgetOverviewTable targetFY={targetFY} fyQuery={fyQuery} rows={overviewRows} />

        <BudgetNotesEditor
          entityId={entity.id}
          targetFiscalYear={targetFY}
          initialNotes={notesRow?.notes ?? ""}
          canManage={canManage}
        />
      </div>

      {/* Print-only worksheet — hidden on screen, shown only by window.print(). */}
      <BudgetPrintWorksheet
        entityName={entity.shortName ?? entity.name}
        priorFY={priorFY}
        targetFY={targetFY}
        funds={fundItems}
        locked={locked}
        approval={approvalSummary}
        openingCentsByFundId={openingCentsByFundId}
        juneNotReconciled={juneNotReconciled}
        budgetNotes={notesRow?.notes ?? null}
      />
    </div>
  );
}

function Breadcrumb({ entitySlug }: { entitySlug: string }) {
  return (
    <div>
      <Link
        href={`/admin/ledger?entity=${entitySlug}`}
        className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        &larr; Ledger Overview
      </Link>
    </div>
  );
}

function PageHeader({
  entity,
  priorFY,
  targetFY,
}: {
  entity: { name: string; shortName: string | null };
  priorFY: number;
  targetFY: number;
}) {
  return (
    <div>
      <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
        Treasury &middot; Budgeting
      </p>
      <h1 className="text-3xl font-bold text-gray-900">Budget Planning</h1>
      <p className="mt-1 text-sm text-gray-500">
        {entity.shortName ?? entity.name} &bull; {fiscalYearLabel(targetFY)} budget &bull; prior
        year reference: {fiscalYearLabel(priorFY)}
      </p>
      <p className="mt-2 text-sm">
        <Link
          href="/admin/ledger/guide#budgeting"
          className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          How budgeting works &rarr;
        </Link>
      </p>
    </div>
  );
}
