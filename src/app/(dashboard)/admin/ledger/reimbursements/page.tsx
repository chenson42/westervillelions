import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  listReimbursementsForAdmin,
  getReimbursementStatusCounts,
  getEntities,
  getFunds,
  getCategories,
  getBudgetLineOptions,
  getBankAccounts,
} from "@/lib/ledger-queries";
import { RejectReimbursementDialog } from "@/components/admin/ledger/reject-dialog";
import PayReimbursementDialog from "@/components/admin/ledger/pay-reimbursement-dialog";
import AddBankAccountButton from "@/components/admin/ledger/add-bank-account-button";
import {
  paidRowNeedsBankAccount,
  paidRowRepairAction,
} from "@/components/admin/ledger/paid-reimbursement-logic";
import { isOwnReimbursementRequest } from "@/lib/ledger";
import type { ReimbursementAdminRow, BudgetLineOption } from "@/lib/ledger-queries";
import type { LedgerFund, LedgerCategory, LedgerBankAccount } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type StatusTab = "submitted" | "approved" | "rejected" | "paid";

const PAGE_SIZE = 50;

const TAB_LABELS: Record<StatusTab, string> = {
  submitted: "Awaiting action",
  approved: "Approved (legacy)",
  rejected: "Rejected",
  paid: "Paid",
};

const EMPTY_MESSAGES: Record<StatusTab, string> = {
  submitted: "No reimbursement requests are waiting for review.",
  approved: "No legacy approved requests.",
  rejected: "No rejected reimbursement requests.",
  paid: "No paid reimbursements yet.",
};

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    submitted: "bg-yellow-50 text-yellow-700 border border-yellow-200",
    approved: "bg-blue-50 text-lions-blue border border-blue-200",
    rejected: "bg-gray-100 text-gray-600 border border-gray-200",
    paid: "bg-green-50 text-green-700 border border-green-200",
  };
  const labels: Record<string, string> = {
    submitted: "Awaiting Treasurer",
    approved: "Approved — Awaiting Payment",
    rejected: "Rejected",
    paid: "Paid",
  };
  const cls = classes[status] ?? "bg-gray-50 text-gray-500";
  const label = labels[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export default async function AdminLedgerReimbursementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
    FEATURES.LEDGER_APPROVE,
  ]);
  if (!canView) redirect("/access-pending");

  // Reject and pay both require ledger.record (DECISION-106). Everyone else
  // who can open this page (e.g. board members) reviews paid requests.
  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);

  const { tab: tabParam, page: pageParam } = await searchParams;
  const validTabs: StatusTab[] = ["submitted", "approved", "rejected", "paid"];
  const defaultTab: StatusTab = canRecord ? "submitted" : "paid";
  const activeTab: StatusTab =
    tabParam && validTabs.includes(tabParam as StatusTab)
      ? (tabParam as StatusTab)
      : defaultTab;
  const parsedPage = Number.parseInt(pageParam ?? "", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const offset = (page - 1) * PAGE_SIZE;

  // Load all entities' funds/categories/budget lines for the Pay dialog
  // (treasurer needs to pick a fund, then a category — B-30, DECISION-061 —
  // and optionally a budget line, at payment time).
  const entities = await getEntities();
  let allFunds: LedgerFund[] = [];
  let allCategories: LedgerCategory[] = [];
  let allBudgetLines: BudgetLineOption[] = [];
  let allBankAccounts: LedgerBankAccount[] = [];
  for (const entity of entities) {
    const [entityFunds, entityCategories, entityBudgetLines, entityBankAccounts] =
      await Promise.all([
        getFunds(entity.id),
        getCategories(entity.id, { flow: "expense" }),
        getBudgetLineOptions(entity.id),
        // Active accounts only (B-108): the Pay dialog requires the account
        // the money came out of, filtered to the selected fund's entity.
        getBankAccounts(entity.id),
      ]);
    allFunds = allFunds.concat(entityFunds);
    allCategories = allCategories.concat(entityCategories);
    allBudgetLines = allBudgetLines.concat(entityBudgetLines);
    allBankAccounts = allBankAccounts.concat(entityBankAccounts);
  }

  const { reimbursements, total } = await listReimbursementsForAdmin({
    status: activeTab,
    limit: PAGE_SIZE,
    offset,
  });

  // Tab counts — one GROUP BY query instead of four separate count round-trips.
  const statusCounts = await getReimbursementStatusCounts();
  const tabCounts: Record<StatusTab, number> = {
    submitted: statusCounts.submitted ?? 0,
    approved: statusCounts.approved ?? 0,
    rejected: statusCounts.rejected ?? 0,
    paid: statusCounts.paid ?? 0,
  };

  // The legacy Approved tab only appears when there is something in it (or the
  // user is already on it), so it does not clutter the common case.
  const visibleTabs = validTabs.filter(
    (t) => t !== "approved" || tabCounts.approved > 0 || activeTab === "approved",
  );

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + reimbursements.length, total);
  const hasPrev = page > 1;
  const hasNext = offset + reimbursements.length < total;
  const pageHref = (p: number) =>
    `/admin/ledger/reimbursements?tab=${activeTab}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Reimbursement Requests</h1>
        <p className="mt-1 text-sm text-gray-500">
          Member expense reimbursements. The treasurer reviews each request, then marks it paid,
          which posts the expense to the fund ledger, or rejects it. The board reviews paid
          requests afterward on the Paid tab.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-0">
        {visibleTabs.map((tab) => {
          const isActive = tab === activeTab;
          const count = tabCounts[tab];
          return (
            <Link
              key={tab}
              href={`/admin/ledger/reimbursements?tab=${tab}`}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue -mb-px ${
                isActive
                  ? "bg-white border border-b-white border-gray-200 text-lions-blue"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {TAB_LABELS[tab]}
              {count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-xs font-bold ${
                    isActive
                      ? "bg-lions-blue text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {activeTab === "paid" && (
        <p className="text-sm text-gray-600">
          Paid reimbursements are listed here, newest payment first, for board review. Each one is
          also posted to the ledger as an expense.
        </p>
      )}

      {/* Table */}
      {reimbursements.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">{EMPTY_MESSAGES[activeTab]}</p>
          {activeTab === "submitted" && (
            <p className="mt-1 text-sm">Members submit requests from their member portal.</p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Submitted
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Member
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  {activeTab === "paid" && (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        Account
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        Check #
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Receipt
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {reimbursements.map((r: ReimbursementAdminRow) => {
                  const memberName = `${r.memberFirstName} ${r.memberLastName}`;
                  const amountStr = formatDollars(r.amountCents);
                  const isSelf = isOwnReimbursementRequest(
                    { id: session.user.id, memberId: session.user.memberId },
                    r,
                  );
                  const isActionable = r.status === "submitted" || r.status === "approved";

                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="font-medium">{memberName}</div>
                        <div className="text-xs text-gray-400">{r.memberEmail}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                        {amountStr}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[220px]">
                        <div className="truncate">{r.description}</div>
                        {r.beneficiaryCause && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">
                            Cause: {r.beneficiaryCause}
                          </div>
                        )}
                        {activeTab === "rejected" && r.rejectionReason && (
                          <div className="mt-1 text-xs text-gray-500 bg-gray-50 rounded p-1.5">
                            <span className="font-medium">Reason:</span> {r.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={r.status} />
                        {r.status === "paid" && r.paidAt && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            Paid {formatDate(r.paidAt)}
                            {r.paidByName && <> by {r.paidByName}</>}
                          </div>
                        )}
                        {r.status === "paid" && r.fundName && (
                          <div className="text-xs text-gray-400">Fund: {r.fundName}</div>
                        )}
                        {r.boardMinute && (
                          <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]" title={r.boardMinute}>
                            Board minute (historical): {r.boardMinute}
                          </div>
                        )}
                      </td>
                      {activeTab === "paid" && (
                        <>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {r.paidTransaction?.bankAccountName ? (
                              <span className="whitespace-nowrap">{r.paidTransaction.bankAccountName}</span>
                            ) : paidRowNeedsBankAccount(r.paidTransaction) ? (
                              <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                Needs bank account
                              </span>
                            ) : (
                              <span className="text-gray-400">&mdash;</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-700">
                            {r.paidTransaction?.checkNumber ?? <span className="text-gray-400">&mdash;</span>}
                          </td>
                        </>
                      )}
                      <td className="whitespace-nowrap px-4 py-3">
                        <a
                          href={`/api/admin/ledger/reimbursements/${r.id}/receipt`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          View
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {/* Awaiting + legacy-approved tabs — Mark Paid and Reject
                              (ledger.record). Own request: another reviewer must act. */}
                          {(activeTab === "submitted" || activeTab === "approved") &&
                            isActionable &&
                            canRecord &&
                            (isSelf ? (
                              <span
                                className="text-xs text-gray-500 italic"
                                title="You submitted this request — another reviewer must act on it"
                              >
                                Submitted by you — another reviewer must act on it
                              </span>
                            ) : (
                              <>
                                <PayReimbursementDialog
                                  reimbursementId={r.id}
                                  memberName={memberName}
                                  amount={amountStr}
                                  amountCents={r.amountCents}
                                  updatedAt={r.updatedAt.toISOString()}
                                  funds={allFunds}
                                  categories={allCategories}
                                  budgetLines={allBudgetLines}
                                  bankAccounts={allBankAccounts}
                                  description={r.description}
                                >
                                  <button
                                    type="button"
                                    className="bg-lions-blue text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                                  >
                                    Mark Paid
                                  </button>
                                </PayReimbursementDialog>
                                <RejectReimbursementDialog
                                  reimbursementId={r.id}
                                  memberName={memberName}
                                  amount={amountStr}
                                >
                                  <span className="inline-flex items-center min-h-[44px] px-3 rounded-lg text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 transition cursor-pointer">
                                    Reject
                                  </span>
                                </RejectReimbursementDialog>
                              </>
                            ))}

                          {/* Paid tab — repair a row recorded without a bank account.
                              Hidden on the viewer's own request (another reviewer
                              must repair it; the server enforces the same). */}
                          {activeTab === "paid" &&
                            r.paidTransaction &&
                            (() => {
                              const repair = paidRowRepairAction({
                                paidTransaction: r.paidTransaction,
                                isSelf,
                                canRecord,
                              });
                              if (repair === "button") {
                                return <AddBankAccountButton transactionId={r.paidTransaction.id} />;
                              }
                              if (repair === "self") {
                                return (
                                  <span className="text-xs text-gray-500 italic">
                                    Submitted by you. Another reviewer must add its bank account.
                                  </span>
                                );
                              }
                              return null;
                            })()}

                          {/* Paid tab — link to transaction */}
                          {activeTab === "paid" && r.ledgerTransactionId && (
                            <span className="text-xs text-gray-400">
                              Txn: {r.ledgerTransactionId.slice(0, 8)}&hellip;
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > 0 && (
        <nav
          aria-label="Reimbursement pages"
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"
        >
          <p>
            Showing {rangeStart}&ndash;{rangeEnd} of {total} request{total !== 1 ? "s" : ""}.
          </p>
          {(hasPrev || hasNext) && (
            <div className="flex gap-2">
              {hasPrev && (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex items-center min-h-[44px] px-4 rounded-lg border-2 border-lions-blue text-lions-blue font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  &larr; Previous
                </Link>
              )}
              {hasNext && (
                <Link
                  href={pageHref(page + 1)}
                  className="inline-flex items-center min-h-[44px] px-4 rounded-lg border-2 border-lions-blue text-lions-blue font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  Next &rarr;
                </Link>
              )}
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
