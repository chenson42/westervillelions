import { redirect } from "next/navigation";
import Link from "next/link";
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

export const dynamic = "force-dynamic";

/**
 * Shared load-error fallback for this page's three DB-fetching phases
 * (Ledger Dashboard, DECISION-032's error-boundary ruling: inline try/catch,
 * not error.tsx — this codebase has no error.tsx precedent and a static
 * failure card needs no client boundary). "Try again" is a plain server
 * re-navigation, no client JS required.
 */
function LoadErrorCard() {
  return (
    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
      <svg
        className="mx-auto h-10 w-10 text-gray-300 mb-3"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="text-lg font-semibold text-gray-700">Couldn&rsquo;t load the ledger</p>
      <p className="mt-1 text-sm">Something went wrong loading this page. Please try again.</p>
      <Link
        href="/admin/ledger"
        className="mt-4 inline-block text-lions-blue hover:underline text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        Try again
      </Link>
    </div>
  );
}

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
    return <LoadErrorCard />;
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
      return <LoadErrorCard />;
    }
  }

  // DETAIL BRANCH — entityParam is a valid slug here
  let entity;
  try {
    entity = await getEntity(entityParam!);
  } catch {
    return <LoadErrorCard />;
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
    return <LoadErrorCard />;
  }
  const [funds, bankAccounts, categories, overview, fiscalYears, pendingTxns] = data;

  return (
    <LedgerEntityDetail
      entity={entity}
      entities={entities}
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
