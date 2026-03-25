import { db } from "@/lib/db";
import { membershipApplications, users } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import ApplicationActionButtons from "@/components/admin/application-action-buttons";

const PAGE_SIZE = 20;

const MEMBER_TYPE_LABELS: Record<string, string> = {
  new: "New Member",
  former: "Former Member",
  transfer: "Transfer Member",
  family: "Family Member",
  student: "Student",
  leo: "Leo",
  young_adult: "Young Adult",
};

export default async function AdminMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.MEMBERSHIP_MANAGE);
  if (!canManage) redirect("/admin");

  const { page: pageParam = "1", status = "pending" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam) || 1);

  const condition =
    status === "all"
      ? undefined
      : eq(membershipApplications.status, status);

  const [applications, [{ count }], [{ pendingCount }]] = await Promise.all([
    db
      .select()
      .from(membershipApplications)
      .where(condition)
      .orderBy(desc(membershipApplications.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipApplications)
      .where(condition),
    db
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(membershipApplications)
      .where(eq(membershipApplications.status, "pending")),
  ]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (status !== "pending") params.set("status", status);
    if (p > 1) params.set("page", String(p));
    return `/admin/membership${params.size > 0 ? `?${params}` : ""}`;
  }

  const statusTabs = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Membership Applications</h1>
          <p className="mt-2 text-gray-600">Review and approve new member applications</p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-lions-blue px-3 py-1 text-sm font-semibold text-white">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {statusTabs.map((tab) => (
          <a
            key={tab.value}
            href={`/admin/membership${tab.value !== "pending" ? `?status=${tab.value}` : ""}`}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              status === tab.value
                ? "bg-lions-blue text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {tab.label}
            {tab.value === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </a>
        ))}
      </div>

      {/* Applications list */}
      {applications.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow">
          <p className="text-lg font-medium text-gray-500">No {status !== "all" ? status : ""} applications</p>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div
              key={app.id}
              className={`rounded-lg border bg-white p-6 shadow-sm ${
                app.status === "pending" ? "border-lions-blue" : "border-gray-200"
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                {/* Applicant info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {app.firstName} {app.middleInitial ? `${app.middleInitial}. ` : ""}{app.lastName}
                      {app.suffix ? ` ${app.suffix}` : ""}
                    </h3>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      app.status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : app.status === "approved"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}>
                      {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {MEMBER_TYPE_LABELS[app.memberType] ?? app.memberType}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-600">
                    <div>
                      <span className="font-medium text-gray-700">Email: </span>
                      <a href={`mailto:${app.email}`} className="hover:text-lions-blue">{app.email}</a>
                    </div>
                    {app.phone && (
                      <div>
                        <span className="font-medium text-gray-700">Phone: </span>{app.phone}
                      </div>
                    )}
                    {app.occupation && (
                      <div>
                        <span className="font-medium text-gray-700">Occupation: </span>{app.occupation}
                      </div>
                    )}
                    {app.sponsorName && (
                      <div>
                        <span className="font-medium text-gray-700">Sponsor: </span>{app.sponsorName}
                      </div>
                    )}
                    {(app.city || app.state) && (
                      <div>
                        <span className="font-medium text-gray-700">Location: </span>
                        {[app.city, app.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                    {app.dateOfBirth && (
                      <div>
                        <span className="font-medium text-gray-700">DOB: </span>{app.dateOfBirth}
                      </div>
                    )}
                    {app.previousClubName && (
                      <div>
                        <span className="font-medium text-gray-700">Previous Club: </span>
                        {app.previousClubName}{app.previousClubNumber ? ` (#${app.previousClubNumber})` : ""}
                      </div>
                    )}
                  </div>

                  {app.adminNotes && (
                    <div className="mt-3 p-3 bg-gray-50 rounded text-sm text-gray-700">
                      <span className="font-medium">Notes: </span>{app.adminNotes}
                    </div>
                  )}

                  <p className="mt-3 text-xs text-gray-400">
                    Submitted {new Date(app.createdAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                {/* Actions */}
                {app.status === "pending" && (
                  <div className="w-full md:w-48 flex-shrink-0">
                    <ApplicationActionButtons id={app.id} />
                  </div>
                )}
              </div>
            </div>
          ))}
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
