import { db } from "@/lib/db";
import { homepageAnnouncements } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { asc } from "drizzle-orm";
import Link from "next/link";
import DeleteAnnouncementButton from "./delete-button";

function formatDateRange(
  startsAt: Date | null,
  endsAt: Date | null
): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);

  if (!startsAt && !endsAt) return "Always";
  if (startsAt && !endsAt) return `From ${fmt(startsAt)}`;
  if (!startsAt && endsAt) return `Until ${fmt(endsAt)}`;
  return `${fmt(startsAt!)} – ${fmt(endsAt!)}`;
}

export default async function AdminAnnouncementsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
  if (!canAccess) redirect("/admin");

  const announcementList = await db
    .select()
    .from(homepageAnnouncements)
    .orderBy(
      asc(homepageAnnouncements.sortOrder),
      asc(homepageAnnouncements.createdAt)
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Announcements</h1>
          <p className="mt-2 text-gray-600">
            Manage homepage announcements and featured notices
          </p>
        </div>
        <Link
          href="/admin/announcements/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 self-start"
        >
          New Announcement
        </Link>
      </div>

      {announcementList.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          <p className="text-lg font-medium">No announcements found</p>
          <p className="mt-1 text-sm">
            Create your first announcement to get started
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Title
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell"
                >
                  Date Range
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {announcementList.map((announcement) => (
                <tr key={announcement.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">
                      {announcement.title}
                    </p>
                    {announcement.body && (
                      <p className="mt-0.5 text-xs text-gray-500 truncate max-w-xs">
                        {announcement.body}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        announcement.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {announcement.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">
                    {formatDateRange(announcement.startsAt, announcement.endsAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/announcements/${announcement.id}`}
                        className="inline-block rounded-md border border-lions-blue px-3 py-1.5 text-sm font-medium text-lions-blue hover:bg-lions-blue hover:text-white transition"
                      >
                        Edit
                      </Link>
                      <DeleteAnnouncementButton id={announcement.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Only <strong>active</strong> announcements within their scheduled
              date range are shown on the homepage. Up to{" "}
              <strong>5 announcements</strong> are displayed, ordered by Sort
              Order (lowest first).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
