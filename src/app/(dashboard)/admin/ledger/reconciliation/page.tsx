import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntities, getBankAccounts } from "@/lib/ledger-queries";
import { getReconciliationSessions } from "@/lib/reconciliation-queries";
import ReconciliationSessionList from "@/components/admin/ledger/reconciliation-session-list";
import NewReconciliationSessionForm from "@/components/admin/ledger/new-reconciliation-session-form";

export const dynamic = "force-dynamic";

type StatusParam = "all" | "open" | "closed";
const VALID_STATUSES: StatusParam[] = ["all", "open", "closed"];

/**
 * Reconciliation session audit trail — every account, every entity.
 * "New session" (LEDGER_RECORD-gated) opens a dialog whose account picker
 * excludes cash-type accounts (Petty Cash, T-20) — the server re-enforces
 * this on POST regardless (design doc: query-level filter is not enough on
 * its own).
 */
export default async function AdminLedgerReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasFeature(session.user.id, FEATURES.LEDGER_VIEW);
  if (!canView) redirect("/access-pending");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);

  const { status: statusParam } = await searchParams;
  const activeStatus: StatusParam =
    statusParam && VALID_STATUSES.includes(statusParam as StatusParam)
      ? (statusParam as StatusParam)
      : "all";

  const entities = await getEntities();
  const accountsByEntity = await Promise.all(entities.map((e) => getBankAccounts(e.id)));

  // Cash-type accounts (Petty Cash) have no bank statement to tie out — never
  // offered in the "New session" account picker. The create route enforces
  // this server-side too.
  const eligibleAccounts = entities.flatMap((e, i) =>
    accountsByEntity[i]
      .filter((a) => a.accountType !== "cash")
      .map((a) => ({
        id: a.id,
        name: a.name,
        last4: a.last4,
        entityId: e.id,
        entityName: e.shortName || e.name,
      })),
  );

  const sessions = await getReconciliationSessions(
    activeStatus === "all" ? {} : { status: activeStatus },
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Bank Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Match bank statements to the books, account by account, and close each period
            once it ties out.
          </p>
        </div>
        {canRecord && <NewReconciliationSessionForm accounts={eligibleAccounts} />}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-0">
        {VALID_STATUSES.map((s) => {
          const isActive = s === activeStatus;
          const label = s === "all" ? "All" : s === "open" ? "Open" : "Closed";
          return (
            <Link
              key={s}
              href={
                s === "all"
                  ? "/admin/ledger/reconciliation"
                  : `/admin/ledger/reconciliation?status=${s}`
              }
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue -mb-px ${
                isActive
                  ? "bg-white border border-b-white border-gray-200 text-lions-blue"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <ReconciliationSessionList sessions={sessions} />
    </div>
  );
}
