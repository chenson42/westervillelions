import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listMinutesForAdmin } from "@/lib/minutes-queries";
import { MINUTES_KINDS, MINUTES_STATUSES, minutesKindLabel } from "@/lib/minutes";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: string): string {
  return status === "approved"
    ? "bg-green-100 text-green-800"
    : "bg-amber-100 text-amber-800";
}

/**
 * Admin minutes list (docs/work-log/2026-08-08-meeting-minutes.md, Phase 3
 * Component/Page Plan). Server Component — calls listMinutesForAdmin()
 * directly, same pattern as every other admin list page in this codebase
 * (e.g. /admin/dues), rather than round-tripping through its own API route.
 */
export default async function AdminMinutesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; deleted?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) redirect("/admin");

  const canDelete = await hasFeature(session.user.id, FEATURES.MINUTES_DELETE);
  const { kind, status, deleted } = await searchParams;
  const includeDeleted = deleted === "1";

  const rows = await listMinutesForAdmin({ kind, status, includeDeleted });

  function filterHref(next: { kind?: string; status?: string; deleted?: boolean }): string {
    const params = new URLSearchParams();
    const nextKind = next.kind !== undefined ? next.kind : kind;
    const nextStatus = next.status !== undefined ? next.status : status;
    const nextDeleted = next.deleted !== undefined ? next.deleted : includeDeleted;
    if (nextKind) params.set("kind", nextKind);
    if (nextStatus) params.set("status", nextStatus);
    if (nextDeleted) params.set("deleted", "1");
    const qs = params.toString();
    return qs ? `/admin/minutes?${qs}` : "/admin/minutes";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Minutes</h1>
          <p className="mt-1 text-gray-600">Meeting minutes — draft, approve, and email the board or club.</p>
        </div>
        <Link
          href="/admin/minutes/new"
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          New Minutes
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={filterHref({ kind: undefined })}
          className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] ${
            !kind ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          All kinds
        </Link>
        {MINUTES_KINDS.map((k) => (
          <Link
            key={k}
            href={filterHref({ kind: k })}
            className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] ${
              kind === k ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {minutesKindLabel(k)}
          </Link>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        <Link
          href={filterHref({ status: undefined })}
          className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] ${
            !status ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          All statuses
        </Link>
        {MINUTES_STATUSES.map((s) => (
          <Link
            key={s}
            href={filterHref({ status: s })}
            className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] capitalize ${
              status === s ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {s}
          </Link>
        ))}
        {canDelete && (
          <>
            <span className="mx-1 text-gray-300">|</span>
            <Link
              href={filterHref({ deleted: !includeDeleted })}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] ${
                includeDeleted ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {includeDeleted ? "Hide deleted" : "Show deleted"}
            </Link>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="mb-2">No minutes match these filters yet.</p>
          <Link href="/admin/minutes/new" className="text-lions-blue hover:underline font-semibold">
            Create the first record
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Meeting
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Kind
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Present
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className={row.pendingDeleteAt ? "bg-red-50/50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/admin/minutes/${row.id}`}
                      className="font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      {row.title || `${minutesKindLabel(row.kind)} minutes — ${row.meetingDate}`}
                    </Link>
                    <p className="text-xs text-gray-500">{row.meetingDate}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{minutesKindLabel(row.kind)}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                    {row.pendingDeleteAt && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Deleted
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.presentCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
