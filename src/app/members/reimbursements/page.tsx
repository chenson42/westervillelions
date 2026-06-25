import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listReimbursementsForMember } from "@/lib/ledger-queries";
import {
  ReimbursementSubmitForm,
  WithdrawButton,
} from "@/components/members/reimbursement-form";
import type { LedgerReimbursement } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    submitted: {
      label: "Awaiting Review",
      cls: "bg-yellow-50 text-yellow-700 border border-yellow-200",
    },
    approved: {
      label: "Approved — Awaiting Payment",
      cls: "bg-blue-50 text-lions-blue border border-blue-200",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-gray-100 text-gray-600 border border-gray-200",
    },
    paid: {
      label: "Paid",
      cls: "bg-green-50 text-green-700 border border-green-200",
    },
  };
  const { label, cls } = map[status] ?? {
    label: status,
    cls: "bg-gray-50 text-gray-500",
  };
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

export default async function MemberReimbursementsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">My Reimbursements</h1>
          <p className="text-blue-100">
            Request reimbursement for out-of-pocket expenses on behalf of the Lions Club.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
        </Link>

        {/* Account not linked state */}
        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <div className="text-4xl mb-4" aria-hidden="true">💼</div>
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked before submitting a reimbursement request.
            </p>
          </div>
        ) : (
          <MemberReimbursementsContent memberId={memberId} />
        )}
      </div>
    </div>
  );
}

async function MemberReimbursementsContent({ memberId }: { memberId: string }) {
  const reimbursements = await listReimbursementsForMember(memberId);

  return (
    <div className="space-y-8">
      {/* Submit form card */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Request a Reimbursement</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Attach your receipt and describe the expense. The board will review and authorize it. The
            treasurer assigns the fund and processes payment. You will receive an email when the
            status changes.
          </p>
        </div>
        <div className="px-6 py-5">
          <ReimbursementSubmitForm />
        </div>
      </div>

      {/* My requests list */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">My Requests</h2>
        </div>

        {reimbursements.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
            <p className="font-medium">No reimbursement requests yet.</p>
            <p className="mt-1 text-sm">
              Use the form above to submit your first request.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {reimbursements.map((r: LedgerReimbursement) => (
              <li key={r.id} className="px-6 py-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 flex-1">
                        {r.description}
                      </p>
                      <p className="text-sm font-bold text-gray-900 tabular-nums whitespace-nowrap">
                        {formatDollars(r.amountCents)}
                      </p>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-gray-400">
                        Submitted {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                      </span>
                      {r.beneficiaryCause && (
                        <span className="text-xs text-gray-500">
                          Cause: {r.beneficiaryCause}
                        </span>
                      )}
                      {r.paidAt && (
                        <span className="text-xs text-gray-500">
                          Paid {formatDate(r.paidAt)}
                        </span>
                      )}
                    </div>

                    {/* Rejection reason */}
                    {r.status === "rejected" && r.rejectionReason && (
                      <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
                        <span className="font-medium text-gray-700">Rejection reason: </span>
                        {r.rejectionReason}
                      </div>
                    )}

                    {/* Board minute (approved/paid — informational) */}
                    {(r.status === "approved" || r.status === "paid") && r.boardMinute && (
                      <div className="mt-1.5 text-xs text-gray-400">
                        Authorized: {r.boardMinute}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Receipt view link */}
                    <a
                      href={`/api/members/reimbursements/${r.id}/receipt`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      View receipt
                    </a>

                    {/* Withdraw — only while submitted */}
                    {r.status === "submitted" && (
                      <WithdrawButton
                        reimbursementId={r.id}
                        description={r.description}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
