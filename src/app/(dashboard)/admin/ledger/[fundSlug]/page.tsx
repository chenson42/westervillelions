import { redirect, notFound } from "next/navigation";
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
  listTransactions,
  listLedgerFiscalYears,
} from "@/lib/ledger-queries";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import TransactionFormDialog from "@/components/admin/ledger/transaction-form-dialog";
import TransactionActions from "@/components/admin/ledger/transaction-actions";
import FundManageDialog from "@/components/admin/ledger/fund-manage-dialog";
import type { LedgerTransaction } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function flowBadgeClass(flow: string, isTransfer: boolean): string {
  if (isTransfer) return "bg-purple-50 text-purple-700";
  if (flow === "income") return "bg-green-50 text-green-700";
  return "bg-orange-50 text-orange-700";
}

function flowLabel(flow: string, isTransfer: boolean): string {
  if (isTransfer) return "Transfer";
  return flow === "income" ? "Income" : "Expense";
}

export default async function AdminLedgerFundPage({
  params,
  searchParams,
}: {
  params: Promise<{ fundSlug: string }>;
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
  ]);
  if (!canView) redirect("/access-pending");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const { fundSlug } = await params;
  const { entity: entityParam, fy: fyParam } = await searchParams;

  // Validate entity
  const entities = await getEntities();
  const validSlugs = entities.map((e) => e.slug);
  const resolvedEntitySlug =
    entityParam && validSlugs.includes(entityParam) ? entityParam : entities[0]?.slug ?? "";
  const entity = await getEntity(resolvedEntitySlug);
  if (!entity) redirect("/admin/ledger");

  // Validate fund slug
  const allFunds = await getFunds(entity.id);
  const fund = allFunds.find((f) => f.slug === fundSlug);
  if (!fund) notFound();

  // Validate fiscal year
  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const fiscalYear = !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;

  const [bankAccounts, categories, transactions, fiscalYears] = await Promise.all([
    getBankAccounts(entity.id),
    getCategories(entity.id),
    listTransactions(entity.id, { fundId: fund.id, fiscalYear }),
    listLedgerFiscalYears(entity.id),
  ]);

  // Build transfer-partner lookup for display
  const transferGroupIds = transactions
    .filter((t) => t.transferGroupId)
    .map((t) => t.transferGroupId!);

  // Fetch all transfer partners (rows that share a transferGroupId with transactions in this view)
  let allRelatedTxns: LedgerTransaction[] = [];
  if (transferGroupIds.length > 0) {
    // listTransactions on the entity (no fundId filter) for the same FY, then filter by groupId
    const entityTxns = await listTransactions(entity.id, { fiscalYear });
    const groupSet = new Set(transferGroupIds);
    allRelatedTxns = entityTxns.filter(
      (t) => t.transferGroupId && groupSet.has(t.transferGroupId)
    );
  }

  // Map: transferGroupId → partner row (the other row in the pair, different fundId)
  const partnerByGroupId = new Map<string, LedgerTransaction>();
  for (const txn of allRelatedTxns) {
    if (txn.transferGroupId && txn.fundId !== fund.id) {
      partnerByGroupId.set(txn.transferGroupId, txn);
    }
  }

  // Category name lookup
  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));
  // Fund name lookup for transfer labels
  const fundNameMap = new Map(allFunds.map((f) => [f.id, f.name]));

  const basePath = `/admin/ledger/${fundSlug}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href={`/admin/ledger?entity=${resolvedEntitySlug}&fy=${fiscalYear}`}
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold text-gray-900">{fund.name}</h1>
            {canManage && <FundManageDialog fund={fund} />}
          </div>
          <p className="mt-1 text-sm text-gray-500 capitalize">
            {fund.kind} fund &bull; {entity.shortName ?? entity.name} &bull; {fiscalYearLabel(fiscalYear)}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/admin/ledger/${fundSlug}/report?entity=${resolvedEntitySlug}&fy=${fiscalYear}`}
            className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center"
          >
            Budget / Actual Report
          </Link>

          {canRecord && (
            <TransactionFormDialog
              entityId={entity.id}
              funds={allFunds}
              categories={categories}
              bankAccounts={bankAccounts}
              trigger={
                <button className="bg-lions-blue text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] whitespace-nowrap text-sm">
                  Record Transaction
                </button>
              }
            />
          )}
        </div>
      </div>

      {/* FY selector */}
      <FiscalYearSelector
        fiscalYears={fiscalYears}
        currentFY={fiscalYear}
        basePath={basePath}
      />

      {/* Transaction table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Party / Fund
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Method
                </th>
                {canRecord && (
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={canRecord ? 7 : 6}>
                    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
                      <p className="font-medium">No transactions recorded for this fund in {fiscalYearLabel(fiscalYear)}.</p>
                      {canRecord && (
                        <p className="mt-2 text-sm">
                          Use &ldquo;Record Transaction&rdquo; above to add the first entry.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => {
                  const isTransfer = Boolean(txn.transferGroupId);
                  const partner = txn.transferGroupId
                    ? partnerByGroupId.get(txn.transferGroupId)
                    : undefined;
                  const partyLabel = isTransfer
                    ? partner
                      ? fundNameMap.get(partner.fundId) ?? "Transfer"
                      : "Transfer"
                    : txn.party ?? "";

                  return (
                    <tr key={txn.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {txn.txnDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${flowBadgeClass(txn.flow, isTransfer)}`}
                        >
                          {flowLabel(txn.flow, isTransfer)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px]">
                        {txn.categoryId ? (
                          categoryNameMap.get(txn.categoryId) ?? <span className="text-gray-400">—</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[160px]">
                        <div className="truncate">{partyLabel || <span className="text-gray-400">—</span>}</div>
                        {txn.memo && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{txn.memo}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums">
                        <span
                          className={
                            txn.flow === "income"
                              ? "text-green-700"
                              : "text-gray-900"
                          }
                        >
                          {txn.flow === "income" ? "+" : "-"}{formatDollars(txn.amountCents)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 capitalize">
                        {txn.paymentMethod ?? <span className="text-gray-300">—</span>}
                      </td>
                      {canRecord && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <TransactionActions
                            transaction={txn}
                            transferPartner={partner ?? null}
                            entityId={entity.id}
                            funds={allFunds}
                            categories={categories}
                            bankAccounts={bankAccounts}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {transactions.length > 0 && (
        <p className="text-sm text-gray-500">
          {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} in {fiscalYearLabel(fiscalYear)}
        </p>
      )}
    </div>
  );
}
