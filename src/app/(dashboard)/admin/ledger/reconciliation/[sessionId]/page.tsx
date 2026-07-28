import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getBankLinesForSession,
  getCandidateTransactionsForMatching,
  getTieOutAssembly,
  getMatchedTransactionsForSession,
} from "@/lib/reconciliation-queries";
import { computeTieOut } from "@/lib/reconciliation";
import { getFunds, getCategories } from "@/lib/ledger-queries";
import ReconciliationCsvUpload from "@/components/admin/ledger/reconciliation-csv-upload";
import ReconciliationTieOutSummary from "@/components/admin/ledger/reconciliation-tie-out-summary";
import ReconciliationMatchingGrid from "@/components/admin/ledger/reconciliation-matching-grid";
import ReconciliationReopenButton from "@/components/admin/ledger/reconciliation-reopen-button";

export const dynamic = "force-dynamic";

/** "Jul 1 – Jul 31, 2025" — date-only "YYYY-MM-DD" strings split by hand
 *  (never `new Date(dateOnlyString)`) per this project's known
 *  naive-timestamp-as-local-time bug class. */
function formatPeriodLabel(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * The reconciliation workbench: upload (if not yet uploaded), the running
 * tie-out summary + close action, and the bank-line matching grid. Data is
 * fetched directly via the reconciliation-queries.ts helpers (this codebase's
 * existing convention — see /admin/ledger/donors — rather than an internal
 * fetch to this feature's own API routes, which exist for client-side
 * mutations).
 */
export default async function ReconciliationSessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasFeature(session.user.id, FEATURES.LEDGER_VIEW);
  if (!canView) redirect("/access-pending");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const { sessionId } = await params;

  const reconSession = await getReconciliationSessionById(sessionId);
  if (!reconSession) notFound();

  const [bankLines, candidateTransactions, tieOutAssembly, funds, categories, matchedTransactions] =
    await Promise.all([
      getBankLinesForSession(sessionId),
      getCandidateTransactionsForMatching(reconSession.bankAccountId),
      getTieOutAssembly(sessionId),
      getFunds(reconSession.entityId),
      getCategories(reconSession.entityId),
      getMatchedTransactionsForSession(sessionId),
    ]);

  const tieOut = computeTieOut({
    openingBalanceCents: reconSession.openingBalanceCents,
    closingBalanceCents: reconSession.closingBalanceCents,
    matchedLineAmountsCents: tieOutAssembly.matchedLineAmountsCents,
    unmatchedInPeriodCount: tieOutAssembly.unmatchedInPeriodBankLineIds.length,
  });

  const isOpen = reconSession.status === "open";
  const periodLabel = formatPeriodLabel(
    reconSession.statementPeriodStart,
    reconSession.statementPeriodEnd,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/ledger/reconciliation"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Reconciliation Sessions
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold capitalize">
            {reconSession.entitySlug} &middot; {reconSession.bankAccountName}
          </p>
          <h1 className="text-3xl font-bold text-gray-900">{periodLabel}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isOpen ? (
            <span className="inline-flex items-center rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold px-3 py-1.5">
              Open
            </span>
          ) : (
            <span className="inline-flex items-center rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-semibold px-3 py-1.5">
              Closed
            </span>
          )}
          {!isOpen && canManage && (
            <ReconciliationReopenButton sessionId={sessionId} periodLabel={periodLabel} />
          )}
        </div>
      </div>

      {isOpen && canRecord && !reconSession.uploadedAt && (
        <ReconciliationCsvUpload sessionId={sessionId} />
      )}

      <ReconciliationTieOutSummary
        sessionId={sessionId}
        tieOut={tieOut}
        isOpen={isOpen}
        canRecord={canRecord}
      />

      <ReconciliationMatchingGrid
        sessionId={sessionId}
        bankLines={bankLines}
        candidateTransactions={candidateTransactions}
        matchedTransactions={matchedTransactions}
        funds={funds}
        categories={categories}
        isOpen={isOpen}
        canRecord={canRecord}
      />
    </div>
  );
}
