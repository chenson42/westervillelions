import { db } from "@/lib/db";
import { googleGroupSyncLog, users } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

const PAGE_SIZE = 25;

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  member_added: "Member added",
  member_removed: "Member removed",
  member_updated: "Member updated",
};

export default async function AdminSyncLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; group?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Page-level gate — B-41 (docs/backlog.md): this page previously had only
  // the auth() check above, so any admin.dashboard holder (the proxy's
  // catch-all admission before this fix) could read every Google Group
  // sync run's added/removed/failed member email addresses. Matches the
  // SUBSCRIPTIONS_VIEW precedent DECISION-083 set for the same class of
  // bulk-PII page: don't rely on the proxy alone to gate it.
  const canView = await hasFeature(session.user.id, FEATURES.SYNC_LOG_VIEW);
  if (!canView) redirect("/access-pending");

  const { page: pageParam = "1", group: groupFilter } = await searchParams;
  const page = Math.max(1, parseInt(pageParam) || 1);

  const condition = groupFilter ? eq(googleGroupSyncLog.groupEmail, groupFilter) : undefined;

  const [rows, [{ count }], distinctGroups] = await Promise.all([
    db
      .select({
        id: googleGroupSyncLog.id,
        groupEmail: googleGroupSyncLog.groupEmail,
        triggerSource: googleGroupSyncLog.triggerSource,
        success: googleGroupSyncLog.success,
        added: googleGroupSyncLog.added,
        removed: googleGroupSyncLog.removed,
        failed: googleGroupSyncLog.failed,
        error: googleGroupSyncLog.error,
        createdAt: googleGroupSyncLog.createdAt,
        triggeredByName: users.name,
        triggeredByEmail: users.email,
      })
      .from(googleGroupSyncLog)
      .leftJoin(users, eq(googleGroupSyncLog.triggeredByUserId, users.id))
      .where(condition)
      .orderBy(desc(googleGroupSyncLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(googleGroupSyncLog)
      .where(condition),
    db
      .selectDistinct({ groupEmail: googleGroupSyncLog.groupEmail })
      .from(googleGroupSyncLog)
      .orderBy(googleGroupSyncLog.groupEmail),
  ]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (groupFilter) params.set("group", groupFilter);
    if (p > 1) params.set("page", String(p));
    return `/admin/sync-log${params.size > 0 ? `?${params}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Google Group Sync Log</h1>
        <p className="mt-2 text-gray-600">
          Audit trail of every sync run between the portal and Google Groups
        </p>
      </div>

      {/* Group filter */}
      <div className="flex flex-wrap gap-2">
        <a
          href="/admin/sync-log"
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
            !groupFilter
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All groups
        </a>
        {distinctGroups.map((g) => (
          <a
            key={g.groupEmail}
            href={`/admin/sync-log?group=${encodeURIComponent(g.groupEmail)}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
              groupFilter === g.groupEmail
                ? "bg-lions-blue text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {g.groupEmail}
          </a>
        ))}
      </div>

      {/* Log entries */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow">
          <p className="text-lg font-medium text-gray-500">No sync runs recorded yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const added = (r.added ?? []) as string[];
            const removed = (r.removed ?? []) as string[];
            const failed = (r.failed ?? []) as { email: string; op: string; error: string }[];
            const noop = added.length === 0 && removed.length === 0 && failed.length === 0 && r.success;
            const triggerLabel = TRIGGER_LABELS[r.triggerSource] ?? r.triggerSource;
            return (
              <div
                key={r.id}
                className={`rounded-lg border bg-white p-5 shadow-sm ${
                  r.success ? "border-gray-200" : "border-red-300"
                }`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-mono text-sm font-semibold text-gray-900">{r.groupEmail}</span>
                      {r.success ? (
                        noop ? (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            No change
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Synced
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Failed
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {triggerLabel}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-3">
                      {new Date(r.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      {(r.triggeredByName || r.triggeredByEmail) && (
                        <> · by {r.triggeredByName ?? r.triggeredByEmail}</>
                      )}
                    </div>

                    {r.error && (
                      <div className="mb-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                        <p className="font-medium mb-1">Error</p>
                        <p className="font-mono text-xs whitespace-pre-wrap">{r.error}</p>
                      </div>
                    )}

                    {(added.length > 0 || removed.length > 0 || failed.length > 0) && (
                      <div className="grid gap-3 sm:grid-cols-3 text-sm">
                        {added.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">
                              Added ({added.length})
                            </p>
                            <ul className="space-y-0.5 text-gray-700 font-mono text-xs">
                              {added.map((email) => (
                                <li key={`a-${email}`} className="truncate">{email}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {removed.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                              Removed ({removed.length})
                            </p>
                            <ul className="space-y-0.5 text-gray-700 font-mono text-xs">
                              {removed.map((email) => (
                                <li key={`r-${email}`} className="truncate">{email}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {failed.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                              Failed ({failed.length})
                            </p>
                            <ul className="space-y-1 text-xs">
                              {failed.map((f, i) => (
                                <li key={`f-${i}`} className="text-gray-700">
                                  <span className="font-mono">{f.email}</span>{" "}
                                  <span className="text-amber-700">({f.op})</span>
                                  <span className="block text-gray-500 mt-0.5">{f.error}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-700">
          <p>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} of {count}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={pageUrl(page - 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Previous
              </a>
            )}
            {page < totalPages && (
              <a
                href={pageUrl(page + 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
