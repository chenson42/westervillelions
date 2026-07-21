import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSettings, getPhilanthropy, type PhilanthropySummary } from "@/lib/ledger-queries";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { currentFiscalYear, deriveCauseFyPills } from "@/lib/fiscal-year";
import ImpactByCause from "@/components/members/impact-by-cause";

export const dynamic = "force-dynamic";

function formatDollarsWhole(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function MemberImpactPage() {
  // 1. Auth check
  const session = await auth();
  if (!session?.user) redirect("/signin");

  // 2. Member link check — inline state, NOT a redirect
  const memberId = session.user.memberId ?? null;

  // 3. Visibility + permission check (only if memberId present). When visibility
  //    is 'members', any linked member passes — so the impact.view lookup only
  //    happens in the 'board' case (MEDIUM-3: no wasted permission query).
  if (memberId) {
    const settings = await getSettings();
    if (settings.philanthropyVisibility === "board") {
      const canView = await hasFeature(session.user.id, FEATURES.IMPACT_VIEW);
      if (!canView) redirect("/access-pending");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Our Community Impact</h1>
          <p className="text-blue-100">See how the Westerville Lions serve our community.</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view the philanthropy dashboard.
            </p>
          </div>
        ) : (
          <ImpactDashboard />
        )}
      </div>
    </div>
  );
}

async function ImpactDashboard() {
  const philanthropy = await getPhilanthropy({ recentGiftsLimit: 8 });

  if (philanthropy.allTimeCents === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="text-base">
          No community giving has been recorded yet. Transactions from the Activity and Charitable
          funds will appear here once posted.
        </p>
      </div>
    );
  }

  const currentFY = currentFiscalYear(new Date());
  // byFiscalYear only ever contains years with actual giving data (built
  // from fyMap in getPhilanthropy(), never synthesized) — the data-driven
  // input to the pill split below.
  const dataYears = philanthropy.byFiscalYear.map((fy) => fy.fiscalYear);
  const { fixed: fixedFiscalYears, more: moreFiscalYears } = deriveCauseFyPills(
    dataYears,
    currentFY,
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <ImpactHeadlineStats philanthropy={philanthropy} />
      <ImpactByCause
        allTime={philanthropy.byCause}
        byCauseByFy={philanthropy.byCauseByFy}
        fixedFiscalYears={fixedFiscalYears}
        moreFiscalYears={moreFiscalYears}
        currentFiscalYear={currentFY}
      />
      <ImpactByFiscalYear philanthropy={philanthropy} />
      {philanthropy.recentGifts.length > 0 && (
        <ImpactRecentGifts philanthropy={philanthropy} />
      )}
    </div>
  );
}

function ImpactHeadlineStats({ philanthropy }: { philanthropy: PhilanthropySummary }) {
  // The books only go back to the earliest recorded fiscal year, so label the
  // total honestly ("Since July 2024") rather than "All-Time". byFiscalYear is
  // sorted desc, so the earliest FY is the last entry (start-year, July start).
  const earliestFy = philanthropy.byFiscalYear.at(-1)?.fiscalYear;
  const totalLabel = earliestFy
    ? `Community Giving Since July ${earliestFy}`
    : "Total Community Giving";

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">
          {totalLabel}
        </p>
        <p className="text-3xl font-bold text-lions-blue">
          {formatDollarsWhole(philanthropy.allTimeCents)}
        </p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">
          This Fiscal Year
        </p>
        <p className="text-3xl font-bold text-lions-blue">
          {formatDollarsWhole(philanthropy.currentFyCents)}
        </p>
      </div>
    </div>
  );
}

function ImpactByFiscalYear({ philanthropy }: { philanthropy: PhilanthropySummary }) {
  if (philanthropy.byFiscalYear.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">Giving by Fiscal Year</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Fiscal Year
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Total Giving
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {philanthropy.byFiscalYear.map((fy) => (
              <tr key={fy.fiscalYear}>
                <td className="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">
                  {fy.label}
                </td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right whitespace-nowrap">
                  {formatDollarsWhole(fy.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImpactRecentGifts({ philanthropy }: { philanthropy: PhilanthropySummary }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">Recent Named Gifts</h3>
      </div>
      <ul className="divide-y divide-gray-100">
        {philanthropy.recentGifts.map((gift, i) => {
          const causeDisplay = gift.cause && gift.cause.trim() ? gift.cause.trim() : "Community support";
          return (
            <li key={i} className="px-6 py-3 text-sm text-gray-700">
              <div>
                <span className="font-medium text-gray-900">
                  {formatDollarsWhole(gift.amountCents)}
                </span>{" "}
                to {gift.party} &middot; {causeDisplay} &middot;{" "}
                <span className="text-gray-500">{formatDate(gift.txnDate)}</span>
              </div>
              {gift.publicNote && (
                <p className="text-xs text-gray-500 mt-1 break-words">{gift.publicNote}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
