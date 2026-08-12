import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  listMemberDuesStatus,
  listKnownFiscalYears,
  getDuesSettings,
  getActiveFiscalYear,
  getDuesMethodTotals,
} from "@/lib/dues-queries";
import { fiscalYearLabel, computeDuesMethodComposition } from "@/lib/dues";
import DuesYearSelector from "@/components/admin/dues-year-selector";
import DuesStatusFilter from "@/components/admin/dues-status-filter";
import DuesStatusBadge from "@/components/admin/dues-status-badge";
import DuesConfigureModal from "@/components/admin/dues-configure-modal";
import DuesMarkPaidButton from "@/components/admin/dues-mark-paid-button";
import DuesMethodDonut from "@/components/admin/dues-method-donut";
import type { DuesStatus } from "@/lib/dues";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminDuesPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; status?: string; search?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.DUES_VIEW,
    FEATURES.DUES_MANAGE,
  ]);
  if (!canView) redirect("/admin");

  const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);
  const canExport = await hasAnyFeature(session.user.id, [
    FEATURES.DUES_MANAGE,
    FEATURES.REPORTS_EXPORT,
  ]);

  const { fy: fyParam, status: statusFilter = "all", search = "" } = await searchParams;
  const activeFY = await getActiveFiscalYear();
  const fy = fyParam ? parseInt(fyParam) : activeFY;

  const [members, knownYears, settings, methodTotals] = await Promise.all([
    listMemberDuesStatus(fy, { search: search || undefined }),
    listKnownFiscalYears(),
    getDuesSettings(fy),
    getDuesMethodTotals(fy, { search: search || undefined }),
  ]);

  // Apply status filter in TypeScript (data is already fetched)
  const filtered =
    statusFilter && statusFilter !== "all"
      ? members.filter((m) => m.status === (statusFilter as DuesStatus))
      : members;

  // Summary stats
  const paidCount = members.filter((m) => m.status === "paid").length;
  const partialCount = members.filter((m) => m.status === "partial").length;
  const unpaidCount = members.filter((m) => m.status === "unpaid").length;
  const totalCollectedCents = members.reduce((sum, m) => sum + m.totalPaidCents, 0);
  const totalExpectedCents = members.reduce((sum, m) => sum + m.expectedAmountCents, 0);
  const methodComposition = computeDuesMethodComposition(
    methodTotals,
    totalExpectedCents,
    totalCollectedCents,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dues</h1>
          <p className="mt-1 text-gray-600 flex items-center gap-2 flex-wrap">
            Annual membership dues tracking — {fiscalYearLabel(fy)}
            {settings?.isActive && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Active Year
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && (
            <Link
              href={`/admin/dues/reminders?fy=${fy}`}
              className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center"
            >
              Send Reminders
            </Link>
          )}
          {canManage && settings && (
            <DuesConfigureModal
              fiscalYear={fy}
              currentIndividualCents={settings.individualAmountCents}
              currentFamilyCents={settings.familyAmountCents}
              isCurrentlyActive={settings.isActive}
              activeFiscalYear={settings.isActive ? fy : activeFY}
            />
          )}
          {canManage && !settings && (
            <DuesConfigureModal
              fiscalYear={fy}
              currentIndividualCents={12000}
              currentFamilyCents={9600}
              isCurrentlyActive={false}
              activeFiscalYear={activeFY}
            />
          )}
          {canExport && (
            <a
              href={`/api/admin/dues/export?fy=${fy}`}
              className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center"
            >
              Export CSV
            </a>
          )}
        </div>
      </div>

      {/* Year selector */}
      <DuesYearSelector
        knownFiscalYears={knownYears}
        currentFY={fy}
        basePath="/admin/dues"
        extraParams={{
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
          ...(search ? { search } : {}),
        }}
      />

      {/* Dues not configured warning */}
      {!settings && (
        <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
          <strong>Dues amounts not configured for {fiscalYearLabel(fy)}.</strong>
          {canManage
            ? " Use \"Configure Dues Amounts\" to set the individual and family rates."
            : " Contact the treasurer to configure dues amounts for this year."}
        </div>
      )}

      {/* Payment composition */}
      <DuesMethodDonut
        composition={methodComposition}
        paidCount={paidCount}
        partialCount={partialCount}
        unpaidCount={unpaidCount}
      />

      {/* Status filter */}
      <DuesStatusFilter
        currentStatus={statusFilter}
        currentFY={fy}
        currentSearch={search}
      />

      {/* Search */}
      <form method="GET" action="/admin/dues" className="flex gap-3">
        <input type="hidden" name="fy" value={fy} />
        {statusFilter && statusFilter !== "all" && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <div className="relative flex-1 max-w-sm">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <input
            type="text"
            name="search"
            defaultValue={search}
            placeholder="Search members..."
            className="block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
        <button
          type="submit"
          className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition"
        >
          Search
        </button>
        {search && (
          <a
            href={`/admin/dues?fy=${fy}${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 transition"
          >
            Clear
          </a>
        )}
      </form>

      {/* Members table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Category
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Paid
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Expected
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
                      {search || statusFilter !== "all"
                        ? "No members match your filters."
                        : "No active members found."}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((member) => (
                  <tr key={member.memberId} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {member.firstName} {member.lastName}
                      </div>
                      <div className="text-xs text-gray-500">{member.email}</div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600 capitalize">
                      {member.duesCategory}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-gray-900">
                      {formatDollars(member.totalPaidCents)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-gray-500">
                      {member.expectedAmountCents > 0
                        ? formatDollars(member.expectedAmountCents)
                        : <span className="text-xs text-yellow-600">Not set</span>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-center">
                      <DuesStatusBadge status={member.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <Link
                        href={`/admin/dues/${member.memberId}?fy=${fy}${statusFilter !== "all" ? `&status=${statusFilter}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                        className="text-lions-blue hover:text-lions-blue-dark text-sm font-medium focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                      >
                        View
                      </Link>
                      {canManage &&
                        member.status !== "paid" &&
                        member.expectedAmountCents > 0 && (
                          <DuesMarkPaidButton
                            memberId={member.memberId}
                            fiscalYear={fy}
                            expectedCents={member.expectedAmountCents}
                            totalPaidCents={member.totalPaidCents}
                          />
                        )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        Showing {filtered.length} of {members.length} member{members.length !== 1 ? "s" : ""}
        {statusFilter !== "all" && ` (${statusFilter} only)`}
      </div>
    </div>
  );
}
