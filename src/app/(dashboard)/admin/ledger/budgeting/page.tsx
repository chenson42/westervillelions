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
  computeSeedFromPriorYear,
} from "@/lib/ledger-queries";
import { isBudgetLocked } from "@/lib/ledger";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import GuidedBudgetSetup, {
  type FundSetupItem,
  type BudgetApprovalSummary,
} from "@/components/admin/ledger/guided-budget-setup";

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
  // --- Auth: two-tier gate (Ruling 3). Guided setup now serves two distinct
  // audiences: LEDGER_MANAGE holders who build the budget line-by-line, and
  // LEDGER_APPROVE holders (e.g. board members) who only need to review and
  // lock/unlock it — the latter may not hold LEDGER_MANAGE at all. Page
  // admission is either/or; canManage/canApprove separately gate individual
  // controls below (mirrors reimbursements/page.tsx L56-73).
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canAccess = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_MANAGE,
    FEATURES.LEDGER_APPROVE,
  ]);
  if (!canAccess) redirect("/access-pending");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
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

  // Guided setup is inherently *next* year's budget — default target FY is
  // currentFY + 1, not the current FY.
  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const targetFY =
    !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY + 1;
  const priorFY = targetFY - 1;
  const fyOptions = [currentFY, currentFY + 1, currentFY + 2];

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

  // Preview: what would be seeded per fund, computed fresh from prior-FY
  // actuals (or prior-FY budget fallback) via computeSeedFromPriorYear.
  const preview = await computeSeedFromPriorYear(entity.id, targetFY);
  const previewByFundId = new Map(preview.funds.map((f) => [f.fund.id, f]));

  // Current target-FY budget rows per fund (for BudgetEditor's pre-fill and
  // the initial, pre-interaction balance readout) — same source
  // [fundSlug]/report/page.tsx already uses to build budgetEditorLines.
  const targetReports = await Promise.all(funds.map((f) => getFundReport(f.id, targetFY)));

  const fundItems: FundSetupItem[] = await Promise.all(
    funds.map(async (fund, i) => {
      const fundPreview = previewByFundId.get(fund.id);
      const seedableLines = fundPreview?.seedableLines ?? [];
      const report = targetReports[i];

      const budgetEditorLines = [
        ...(report?.income ?? []).map((l) => ({
          categoryId: l.categoryId,
          categoryName: l.categoryName,
          flow: "income" as const,
          budgetCents: l.budgetCents,
          countsAsGiving: l.countsAsGiving,
          causeLines: l.causeLines,
        })),
        ...(report?.expense ?? []).map((l) => ({
          categoryId: l.categoryId,
          categoryName: l.categoryName,
          flow: "expense" as const,
          budgetCents: l.budgetCents,
          countsAsGiving: l.countsAsGiving,
          causeLines: l.causeLines,
        })),
      ];

      // deriveSeedLinesForFund emits either all "actual" or all "prior_budget"
      // lines for a given fund — never mixed — so checking the first line's
      // source tells us which branch fired fund-wide.
      const seededFromBudgetFallback =
        seedableLines.length > 0 && seedableLines.every((l) => l.source === "prior_budget");

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
        seedableCount: fundPreview?.seedableCount ?? 0,
        collisionCount: fundPreview?.collisionCount ?? 0,
        seededFromBudgetFallback,
        seedableLines,
        budgetEditorLines,
        unbudgetedCategories,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <Breadcrumb entitySlug={resolvedSlug} />
      <PageHeader entity={entity} priorFY={priorFY} targetFY={targetFY} />

      {/* Entity switcher + target FY selector */}
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

      <GuidedBudgetSetup
        entityId={entity.id}
        priorFiscalYear={priorFY}
        targetFiscalYear={targetFY}
        funds={fundItems}
        canManage={canManage}
        canApprove={canApprove}
        locked={locked}
        approval={approvalSummary}
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
        Treasury &middot; Guided Budgeting
      </p>
      <h1 className="text-3xl font-bold text-gray-900">Guided Budget Setup</h1>
      <p className="mt-1 text-sm text-gray-500">
        {entity.shortName ?? entity.name} &bull; Seed {fiscalYearLabel(targetFY)} from{" "}
        {fiscalYearLabel(priorFY)}
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
