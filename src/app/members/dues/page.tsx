import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMemberDuesForUser, listKnownFiscalYears, getActiveFiscalYear } from "@/lib/dues-queries";
import { fiscalYearLabel } from "@/lib/dues";
import DuesStatusBadge from "@/components/admin/dues-status-badge";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
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

export default async function MemberDuesPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { fy: fyParam } = await searchParams;
  const fy = fyParam ? parseInt(fyParam) : await getActiveFiscalYear();

  const memberId = session.user.memberId ?? null;

  // Fetch known years regardless — used for the year selector
  const knownYears = await listKnownFiscalYears();

  // Ensure current FY appears in the list
  const years = knownYears.includes(fy) ? knownYears : [fy, ...knownYears];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">My Dues</h1>
          <p className="text-blue-100">View your annual membership dues status and payment history.</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
        </Link>

        {/* No linked member account */}
        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <div className="text-4xl mb-4" aria-hidden="true">💼</div>
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view your dues status.
            </p>
          </div>
        ) : (
          <MemberDuesContent memberId={memberId} fy={fy} years={years} />
        )}
      </div>
    </div>
  );
}

// Inner async component to fetch and display dues data once memberId is confirmed
async function MemberDuesContent({
  memberId,
  fy,
  years,
}: {
  memberId: string;
  fy: number;
  years: number[];
}) {
  const data = await getMemberDuesForUser(memberId, fy);

  if (!data) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="text-lg font-medium">Could not load dues information.</p>
        <p className="text-sm mt-1">Please try again or contact the club treasurer.</p>
      </div>
    );
  }

  const { member, payments, status, totalPaidCents, expectedAmountCents, settings } = data;
  const isRefundNet = totalPaidCents < 0;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Year selector */}
      <div className="flex items-center gap-3 bg-white rounded-2xl shadow-sm px-5 py-3">
        <label htmlFor="member-dues-fy" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Fiscal Year
        </label>
        <form method="GET" action="/members/dues" className="flex items-center gap-2">
          <select
            id="member-dues-fy"
            name="fy"
            defaultValue={fy}
            className="rounded-md border border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {fiscalYearLabel(y)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-lions-blue text-white text-sm font-medium hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Go
          </button>
        </form>
      </div>

      {/* Status card */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark px-6 py-4 text-white">
          <p className="text-sm text-blue-200 uppercase tracking-wider font-medium">
            {fiscalYearLabel(fy)}
          </p>
          <h2 className="text-xl font-bold mt-1">
            {member.firstName} {member.lastName}
          </h2>
          <p className="text-blue-100 text-sm mt-0.5 capitalize">
            {member.duesCategory} member
          </p>
        </div>

        <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Status</p>
            <div className="mt-1">
              <DuesStatusBadge status={status} />
            </div>
          </div>

          <div className="sm:ml-8">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Amount Paid</p>
            <p className={`text-2xl font-bold mt-0.5 ${isRefundNet ? "text-orange-600" : "text-gray-900"}`}>
              {formatDollars(totalPaidCents)}
            </p>
          </div>

          {settings && expectedAmountCents > 0 && (
            <div className="sm:ml-8">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Expected</p>
              <p className="text-2xl font-bold text-gray-400 mt-0.5">
                {formatDollars(expectedAmountCents)}
              </p>
            </div>
          )}

          {!settings && (
            <div className="sm:ml-8 text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
              Dues amounts not yet configured for this year.
            </div>
          )}
        </div>
      </div>

      {/* Payment history */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            Payment History
          </h3>
        </div>

        {payments.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
            No payments have been recorded for {fiscalYearLabel(fy)} yet.
            Contact the club treasurer if you believe this is incorrect.
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {payments.map((payment) => {
                  const isRefund = payment.amountCents < 0;
                  return (
                    <tr key={payment.id}>
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
                            <span className="ml-1 text-xs font-normal text-orange-500">
                              Refund
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {payment.notes ?? "—"}
                      </td>
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
