import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listReimbursementsForAdmin, getReimbursementStatusCounts, getEntities, getFunds } from "@/lib/ledger-queries";
import ApproveReimbursementDialog from "@/components/admin/ledger/approve-reimbursement-dialog";
import { RejectReimbursementDialog } from "@/components/admin/ledger/reject-dialog";
import PayReimbursementDialog from "@/components/admin/ledger/pay-reimbursement-dialog";
import type { ReimbursementWithMember } from "@/lib/ledger-queries";
import type { LedgerFund } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type StatusTab = "submitted" | "approved" | "rejected" | "paid";

const TAB_LABELS: Record<StatusTab, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
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
    submitted: "Awaiting Board Review",
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
  searchParams: Promise<{ tab?: string }>;
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

  const canApprove = await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE);
  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);

  const { tab: tabParam } = await searchParams;
  const validTabs: StatusTab[] = ["submitted", "approved", "rejected", "paid"];
  const activeTab: StatusTab =
    tabParam && validTabs.includes(tabParam as StatusTab)
      ? (tabParam as StatusTab)
      : "submitted";

  // Load all entities' funds for the Pay dialog (treasurer needs to pick a fund)
  const entities = await getEntities();
  let allFunds: LedgerFund[] = [];
  for (const entity of entities) {
    const entityFunds = await getFunds(entity.id);
    allFunds = allFunds.concat(entityFunds);
  }

  const { reimbursements, total } = await listReimbursementsForAdmin({ status: activeTab });

  // Tab counts — one GROUP BY query instead of four separate count round-trips.
  const statusCounts = await getReimbursementStatusCounts();
  const tabCounts: Record<StatusTab, number> = {
    submitted: statusCounts.submitted ?? 0,
    approved: statusCounts.approved ?? 0,
    rejected: statusCounts.rejected ?? 0,
    paid: statusCounts.paid ?? 0,
  };

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
          Member expense reimbursements — review receipts, approve, and mark paid to post the expense
          to the fund ledger.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-0">
        {validTabs.map((tab) => {
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

      {/* Table */}
      {reimbursements.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No {TAB_LABELS[activeTab].toLowerCase()} reimbursement requests.</p>
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Receipt
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {reimbursements.map((r: ReimbursementWithMember) => {
                  const memberName = `${r.memberFirstName} ${r.memberLastName}`;
                  const amountStr = formatDollars(r.amountCents);
                  const isSelf =
                    session.user.memberId != null &&
                    session.user.memberId === r.submittedByMemberId;

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
                        {activeTab === "paid" && r.paidAt && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            Paid {formatDate(r.paidAt)}
                          </div>
                        )}
                        {activeTab === "approved" && r.boardMinute && (
                          <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]" title={r.boardMinute}>
                            Min: {r.boardMinute}
                          </div>
                        )}
                      </td>
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
                          {/* Submitted tab actions — approve + reject (LEDGER_APPROVE) */}
                          {activeTab === "submitted" && canApprove && (
                            <>
                              {isSelf ? (
                                <span
                                  className="text-xs text-gray-400 italic"
                                  title="You cannot approve your own reimbursement"
                                >
                                  Self-submitted
                                </span>
                              ) : (
                                <ApproveReimbursementDialog
                                  reimbursementId={r.id}
                                  memberName={memberName}
                                  amount={amountStr}
                                >
                                  <button
                                    type="button"
                                    className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                                  >
                                    Approve
                                  </button>
                                </ApproveReimbursementDialog>
                              )}
                              <RejectReimbursementDialog
                                reimbursementId={r.id}
                                memberName={memberName}
                                amount={amountStr}
                              >
                                <span className="text-xs font-medium text-gray-500 hover:text-red-600 transition cursor-pointer rounded px-2 py-1">
                                  Reject
                                </span>
                              </RejectReimbursementDialog>
                            </>
                          )}

                          {/* Approved tab — Mark Paid (LEDGER_RECORD) */}
                          {activeTab === "approved" && canRecord && (
                            <PayReimbursementDialog
                              reimbursementId={r.id}
                              memberName={memberName}
                              amount={amountStr}
                              funds={allFunds}
                            >
                              <button
                                type="button"
                                className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                              >
                                Mark Paid
                              </button>
                            </PayReimbursementDialog>
                          )}

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

      {total > 50 && (
        <p className="text-sm text-gray-500">
          Showing first 50 of {total} requests.
        </p>
      )}
    </div>
  );
}
