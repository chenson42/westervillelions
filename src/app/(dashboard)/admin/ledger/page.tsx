import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  getFunds,
  getBankAccounts,
  getCategories,
  getOverview,
  listLedgerFiscalYears,
  getPendingApprovals,
  getDashboard,
} from "@/lib/ledger-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import LedgerDashboard from "@/components/admin/ledger/ledger-dashboard";
import LedgerEntityDetail from "@/components/admin/ledger/ledger-entity-detail";
import LoadErrorCard from "@/components/admin/ledger/load-error-card";

export const dynamic = "force-dynamic";

export default async function AdminLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin"); // outside any try — safe

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
  ]);
  if (!canView) redirect("/access-pending"); // outside any try — safe

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  const canApprove = await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE);

  const { entity: entityParam, fy: fyParam } = await searchParams;

  let entities;
  try {
    entities = await getEntities();
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  // Bare /admin/ledger (no entity param), or an invalid one, renders the
  // two-entity dashboard. Valid ?entity=<slug> renders the existing
  // per-entity detail view, unchanged (Architectural Ruling 1 / DECISION-031).
  const validSlugs = entities.map((e) => e.slug);
  const hasValidEntity = !!entityParam && validSlugs.includes(entityParam);

  if (!hasValidEntity) {
    try {
      const [dashboard, pendingTxns] = await Promise.all([
        getDashboard(),
        canApprove ? getPendingApprovals() : Promise.resolve([]),
      ]);
      return (
        <LedgerDashboard
          dashboard={dashboard}
          canApprove={canApprove}
          pendingCount={pendingTxns.length}
        />
      );
    } catch {
      return <LoadErrorCard backHref="/admin/ledger" />;
    }
  }

  // DETAIL BRANCH — entityParam is a valid slug here
  let entity;
  try {
    entity = await getEntity(entityParam!);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }
  if (!entity) redirect("/admin/ledger"); // outside try — safe; defensive, unreachable in practice

  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const fiscalYear = !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;

  let data;
  try {
    data = await Promise.all([
      getFunds(entity.id),
      getBankAccounts(entity.id),
      getCategories(entity.id),
      getOverview(entity.id, fiscalYear),
      listLedgerFiscalYears(entity.id),
      canApprove ? getPendingApprovals() : Promise.resolve([]),
    ]);
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }
  const [funds, bankAccounts, categories, overview, fiscalYears, pendingTxns] = data;

  return (
    <LedgerEntityDetail
      entity={entity}
      resolvedSlug={entity.slug}
      fiscalYear={fiscalYear}
      funds={funds}
      bankAccounts={bankAccounts}
      categories={categories}
      overview={overview}
      fiscalYears={fiscalYears}
      pendingTxns={pendingTxns}
      canRecord={canRecord}
      canApprove={canApprove}
    />
  );
}
