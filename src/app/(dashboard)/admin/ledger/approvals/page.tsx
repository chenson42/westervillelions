import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getPendingApprovals, getSettings } from "@/lib/ledger-queries";
import ApproveDialog from "@/components/admin/ledger/approve-dialog";
import { RejectTransactionDialog } from "@/components/admin/ledger/reject-dialog";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminLedgerApprovalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canApprove = await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE);
  if (!canApprove) redirect("/admin/ledger");

  const [pending, settings] = await Promise.all([
    getPendingApprovals(),
    getSettings(),
  ]);

  const threshold = formatDollars(settings.disbApprovalThresholdCents);
  const currentUserId = session.user.id;

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
        <h1 className="text-3xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Disbursements over the board approval threshold ({threshold}) require authorization before
          posting to fund balances.
        </p>
      </div>

      {/* Badge count */}
      {pending.length > 0 && (
        <div className="inline-flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-2">
          <svg
            className="h-4 w-4 text-yellow-600"
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
          <span className="text-sm font-semibold text-yellow-800">
            {pending.length} disbursement{pending.length !== 1 ? "s" : ""} awaiting approval
          </span>
        </div>
      )}

      {/* Empty state */}
      {pending.length === 0 ? (
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
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-lg font-semibold text-gray-700">All expenditures are approved</p>
          <p className="mt-1 text-sm">
            No pending disbursements. The approval threshold is {threshold}.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Fund
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Payee / Memo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Recorded by
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {pending.map((txn) => {
                  const isSelf = txn.recordedByUserId === currentUserId;
                  const amountStr = formatDollars(txn.amountCents);

                  return (
                    <tr key={txn.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatDate(txn.txnDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[220px]">
                        {txn.partnerFundName ? (
                          <div className="space-y-0.5">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                txn.partnerEntityId && txn.partnerEntityId !== txn.entityId
                                  ? "bg-purple-50 text-purple-700"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {txn.partnerEntityId && txn.partnerEntityId !== txn.entityId
                                ? "Sweep"
                                : "Transfer"}
                            </span>
                            <div className="truncate text-gray-600">
                              {txn.fundName ?? "Unknown Fund"}{" "}
                              <span className="text-gray-400">&rarr;</span> {txn.partnerFundName}
                            </div>
                          </div>
                        ) : (
                          txn.fundName ?? <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                        {amountStr}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px]">
                        {txn.party ? (
                          <div className="truncate font-medium">{txn.party}</div>
                        ) : null}
                        {txn.memo ? (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{txn.memo}</div>
                        ) : null}
                        {!txn.party && !txn.memo && (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {isSelf ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-medium bg-amber-50 rounded px-2 py-0.5">
                            You recorded this
                          </span>
                        ) : (
                          <span className="text-sm text-gray-600">{txn.recorderName ?? "—"}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {isSelf ? (
                            <span
                              className="text-xs text-gray-400 italic"
                              title="You cannot approve a disbursement you recorded (segregation of duties)"
                            >
                              Cannot self-approve
                            </span>
                          ) : (
                            <ApproveDialog
                              transactionId={txn.id}
                              amount={amountStr}
                              party={txn.party ?? ""}
                              existingBoardMinute={txn.boardMinute}
                            >
                              <button
                                type="button"
                                className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                              >
                                Approve
                              </button>
                            </ApproveDialog>
                          )}

                          <RejectTransactionDialog
                            transactionId={txn.id}
                            amount={amountStr}
                            party={txn.party ?? ""}
                          >
                            <span className="text-xs font-medium text-gray-500 hover:text-red-600 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1">
                              Reject
                            </span>
                          </RejectTransactionDialog>
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

      <p className="text-xs text-gray-400">
        Transactions become editable only while pending. Once approved, they are locked. The
        approval threshold is currently set to {threshold} (contact the site administrator to change
        this setting).
      </p>
    </div>
  );
}
