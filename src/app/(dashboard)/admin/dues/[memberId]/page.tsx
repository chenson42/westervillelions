import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getMemberPaymentLog, listKnownFiscalYears } from "@/lib/dues-queries";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/dues";
import DuesYearSelector from "@/components/admin/dues-year-selector";
import DuesStatusBadge from "@/components/admin/dues-status-badge";
import DuesCategoryControl from "@/components/admin/dues-category-control";
import DuesAddPaymentButton from "@/components/admin/dues-add-payment-button";
import DuesPaymentActions from "@/components/admin/dues-payment-actions";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function formatDate(dateStr: string): string {
  // paymentDate is a YYYY-MM-DD date string from the DB
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  zeffy: "Zeffy",
  other: "Other",
};

export default async function AdminDuesMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.DUES_VIEW,
    FEATURES.DUES_MANAGE,
  ]);
  if (!canView) redirect("/admin");

  const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);

  const { memberId } = await params;
  const { fy: fyParam } = await searchParams;
  const fy = fyParam ? parseInt(fyParam) : currentFiscalYear(new Date());

  const [log, knownYears] = await Promise.all([
    getMemberPaymentLog(memberId, fy),
    listKnownFiscalYears(),
  ]);

  if (!log) notFound();

  const { member, payments, status, totalPaidCents, expectedAmountCents, settings } = log;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Link
        href={`/admin/dues?fy=${fy}`}
        className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        &larr; Back to Dues List
      </Link>

      {/* Member header */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark px-6 py-4 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold">
                {member.firstName} {member.lastName}
              </h1>
              <p className="text-blue-100 text-sm">{member.email}</p>
              {member.memberNumber && (
                <p className="text-blue-200 text-xs mt-0.5">Member #{member.memberNumber}</p>
              )}
            </div>
            <DuesStatusBadge status={status} />
          </div>
        </div>

        {/* Status summary */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                {fiscalYearLabel(fy)}
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">
                {formatDollars(totalPaidCents)}
                {expectedAmountCents > 0 && (
                  <span className="text-base font-normal text-gray-400">
                    {" "}/{" "}{formatDollars(expectedAmountCents)}
                  </span>
                )}
              </p>
              {!settings && (
                <p className="text-xs text-yellow-600 mt-1">
                  Dues amounts not configured for this year.
                </p>
              )}
            </div>

            {/* Category control (manage only) */}
            {canManage ? (
              <DuesCategoryControl
                memberId={member.id}
                currentCategory={member.duesCategory}
                expectedAmountCents={expectedAmountCents}
              />
            ) : (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Category</p>
                <p className="text-sm font-medium text-gray-700 capitalize mt-0.5">
                  {member.duesCategory}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Year selector */}
        <div className="px-6 py-3 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
          <DuesYearSelector
            knownFiscalYears={knownYears}
            currentFY={fy}
            basePath={`/admin/dues/${memberId}`}
          />
          {canManage && (
            <DuesAddPaymentButton memberId={memberId} fiscalYear={fy} />
          )}
        </div>
      </div>

      {/* Payment log */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Payment History — {fiscalYearLabel(fy)}
          </h2>
        </div>

        {payments.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
            {canManage
              ? "No payments recorded for this year. Use \"Add Payment\" above to record the first payment."
              : "No payments have been recorded for this year yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Method
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Notes
                  </th>
                  {canManage && (
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {payments.map((payment) => {
                  const isRefund = payment.amountCents < 0;
                  return (
                    <tr key={payment.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {formatDate(payment.paymentDate)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {METHOD_LABELS[payment.method] ?? payment.method}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <span
                          className={`text-sm font-medium ${
                            isRefund ? "text-orange-600" : "text-gray-900"
                          }`}
                        >
                          {formatDollars(payment.amountCents)}
                          {isRefund && (
                            <span className="ml-1.5 text-xs font-normal text-orange-500">
                              Refund
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {payment.notes ?? "—"}
                      </td>
                      {canManage && (
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <DuesPaymentActions memberId={memberId} payment={payment} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
