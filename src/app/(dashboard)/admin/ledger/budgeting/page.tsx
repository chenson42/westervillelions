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
  getCategories,
  getBudgetApproval,
  getBudgetCauseLineLabels,
} from "@/lib/ledger-queries";
import { isBudgetLocked, causeLineReferenceKey } from "@/lib/ledger";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import GuidedBudgetSetup, {
  type FundSetupItem,
  type BudgetApprovalSummary,
} from "@/components/admin/ledger/guided-budget-setup";
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
  // --- Auth: two-tier gate (Ruling 3), widened additively by the Budget
  // Permissions feature (docs/work-log/2026-07-29-budget-permissions.md) to
  // admit BUDGET_VIEW/BUDGET_EDIT holders (Treasurer, Budget Committee)
  // alongside the existing LEDGER_MANAGE (builds the budget) and
  // LEDGER_APPROVE (reviews and locks/unlocks it, e.g. board members who may
  // not hold LEDGER_MANAGE at all) holders. Page admission is any-of;
  // canManage/canApprove separately gate individual controls below (mirrors
  // reimbursements/page.tsx L56-73). No budget.approve key exists by
  // design — canApprove stays LEDGER_APPROVE-only, untouched.
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

  const entities = await getEntities();
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  const validSlugs = entities.map((e) => e.slug);
  // Unlike reports/report pages, an invalid explicit ?entity= falls back to
  // the first entity rather than 404 — this is a setup tool, not a permalink.
  const resolvedSlug =
    entityParam && validSlugs.includes(entityParam) ? entityParam : entities[0].slug;

  const entity = await getEntity(resolvedSlug);
  if (!entity) notFound();

  // Default target FY is the CURRENT fiscal year — clubs budget the year they
  // are in (the budget is typically set at/near the year's start). Planning a
  // future year is still one click away via the fiscal-year selector (?fy=).
  // (Changed 2026-07-28 from currentFY+1: the next-year default kept landing
  // treasurers on an empty year and hiding the current year's real budget —
  // see docs/work-log/2026-07-28-budgeting-default-fy.md.)
  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const targetFY =
    !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;
  const priorFY = targetFY - 1;
  // Prior / current / next fiscal year — the prior year lets treasurers view the
  // completed reference budget (e.g. FY2025) that forward-only options hid.
  const fyOptions = [currentFY - 1, currentFY, currentFY + 1];

  const funds = await getFunds(entity.id);

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
  const approval = await getBudgetApproval(entity.id, targetFY);
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

  // Current target-FY budget rows per fund (for BudgetEditor's pre-fill and
  // the initial, pre-interaction balance readout) — same source
  // [fundSlug]/report/page.tsx already uses to build budgetEditorLines.
  // priorReports: same query at priorFY, read-only reuse for the Increment 1
  // reference columns (Prior Budget / Prior Actual) — no new aggregation,
  // see docs/work-log/2026-07-28-budgeting-page-redesign.md Phase 1 grounding
  // note 1. labelOptions is fetched once per page load (entity-scoped,
  // DECISION-048 item 4), not once per fund — shared across every
  // BudgetEditor instance this page renders.
  const [targetReports, priorReports, labelOptions] = await Promise.all([
    Promise.all(funds.map((f) => getFundReport(f.id, targetFY))),
    Promise.all(funds.map((f) => getFundReport(f.id, priorFY))),
    getBudgetCauseLineLabels(entity.id),
  ]);

  const fundItems: FundSetupItem[] = await Promise.all(
    funds.map(async (fund, i) => {
      const report = targetReports[i];
      const priorReport = priorReports[i];

      // Keyed the same way BudgetEditor keys its rows (`${categoryId}_${flow}`)
      // so lookups below are a single map hit, no per-row scan.
      const priorByKey = new Map<string, { budgetCents: number | null; actualCents: number }>();
      for (const l of priorReport?.income ?? []) {
        priorByKey.set(`${l.categoryId}_income`, { budgetCents: l.budgetCents, actualCents: l.actualCents });
      }
      for (const l of priorReport?.expense ?? []) {
        priorByKey.set(`${l.categoryId}_expense`, { budgetCents: l.budgetCents, actualCents: l.actualCents });
      }

      // Cause/beneficiary prior-year reference (2026-07-28-causeline-prior-
      // year-reference — extends the category-grain reference above to the
      // cause/beneficiary lines inside a category's breakdown). Both maps
      // are keyed via causeLineReferenceKey(categoryId, cause, label):
      //   - priorCauseBudgetByKey: the prior FY's OWN cause lines, matched
      //     (cause, label) -> amountCents. null when FY(priorFY) has no
      //     budget line for that (cause, label) yet (e.g. no FY2025 budget
      //     entered at all).
      //   - priorReport.causeActualsByKey: the prior FY's posted expense
      //     actuals grouped by (cause, party) — already computed by
      //     getFundReport from data it fetches anyway, no extra query here.
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
              /** Budgeting Page Restructure (DECISION-054/055/056) — own-flag
               *  soft-delete state, threaded straight through from
               *  getFundReport's widened causeLines[] shape. */
              pendingDeleteAt: string | null;
              /** Budget Star & Notes (DECISION-057) — threaded straight
               *  through from getFundReport's widened causeLines[] shape. */
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

      // "+ Add category" needs the fund's active-but-not-yet-a-line
      // categories per flow (Component Plan / Phase 1 empty-fund gap). In
      // practice getFundReport already returns every active category as a
      // line, so this is usually empty — but it's the correct, defensive
      // source of truth and it's what makes an empty fund (zero categories
      // at all) show "+ New category…" as its only path forward. Only
      // fetched when it can actually be used (canManage, unlocked).
      let unbudgetedCategories: FundSetupItem["unbudgetedCategories"] = {
        income: [],
        expense: [],
      };
      if (canManage && !locked) {
        const budgetedKeys = new Set(budgetEditorLines.map((l) => `${l.categoryId}_${l.flow}`));
        const [incomeCats, expenseCats] = await Promise.all([
          getCategories(entity.id, { fundKind: fund.kind, flow: "income" }),
          getCategories(entity.id, { fundKind: fund.kind, flow: "expense" }),
        ]);
        unbudgetedCategories = {
          income: incomeCats
            .filter((c) => !budgetedKeys.has(`${c.id}_income`))
            .map((c) => ({ id: c.id, name: c.name })),
          expense: expenseCats
            .filter((c) => !budgetedKeys.has(`${c.id}_expense`))
            .map((c) => ({ id: c.id, name: c.name })),
        };
      }

      return {
        fundId: fund.id,
        fundSlug: fund.slug,
        fundName: fund.name,
        fundKind: fund.kind,
        budgetEditorLines,
        unbudgetedCategories,
      };
    }),
  );

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

        <GuidedBudgetSetup
          entityId={entity.id}
          targetFiscalYear={targetFY}
          funds={fundItems}
          canManage={canManage}
          canApprove={canApprove}
          locked={locked}
          approval={approvalSummary}
          labelOptions={labelOptions}
        />
      </div>

      {/* Print-only worksheet — hidden on screen, shown only by window.print().
          Static data snapshot (not the live BudgetEditor inputs) per Phase 1
          design: category, prior-year budget + actual reference columns, and
          this year's saved budget value, with spare hand-annotation lines. */}
      <BudgetPrintWorksheet
        entityName={entity.shortName ?? entity.name}
        priorFY={priorFY}
        targetFY={targetFY}
        funds={fundItems}
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
