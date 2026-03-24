import { db } from "@/lib/db";
import { contactSubmissions } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { desc, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import MarkReadButton from "@/components/admin/mark-read-button";

const PAGE_SIZE = 25;

export default async function AdminContactPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasFeature(session.user.id, FEATURES.CONTACT_VIEW);
  if (!canView) redirect("/admin");

  const { page: pageParam = "1", view = "unread" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam) || 1);
  const showAll = view === "all";

  const { eq } = await import("drizzle-orm");

  const condition = showAll ? undefined : eq(contactSubmissions.isRead, false);

  const [submissions, [{ count }]] = await Promise.all([
    db
      .select()
      .from(contactSubmissions)
      .where(condition)
      .orderBy(desc(contactSubmissions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactSubmissions)
      .where(condition),
  ]);

  const [{ unreadCount }] = await db
    .select({ unreadCount: sql<number>`count(*)::int` })
    .from(contactSubmissions)
    .where(eq(contactSubmissions.isRead, false));

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (showAll) params.set("view", "all");
    if (p > 1) params.set("page", String(p));
    return `/admin/contact${params.size > 0 ? `?${params}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contact Submissions</h1>
          <p className="mt-2 text-gray-600">Messages submitted through the website contact form</p>
        </div>
        {unreadCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-lions-blue px-3 py-1 text-sm font-semibold text-white">
            {unreadCount} unread
          </span>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <a
          href="/admin/contact"
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            !showAll
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
        </a>
        <a
          href="/admin/contact?view=all"
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            showAll
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All
        </a>
      </div>

      {/* Submissions */}
      {submissions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow">
          <p className="text-lg font-medium text-gray-500">
            {showAll ? "No submissions yet" : "No unread messages"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className={`rounded-lg border bg-white p-6 shadow-sm ${
                sub.isRead ? "border-gray-200" : "border-lions-blue"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    {!sub.isRead && (
                      <span className="inline-flex h-2 w-2 rounded-full bg-lions-blue flex-shrink-0" />
                    )}
                    <h3 className="font-semibold text-gray-900 truncate">{sub.subject}</h3>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                    <span className="font-medium text-gray-700">{sub.name}</span>
                    <span>·</span>
                    <a href={`mailto:${sub.email}`} className="hover:text-lions-blue">
                      {sub.email}
                    </a>
                    <span>·</span>
                    <span>
                      {new Date(sub.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{sub.message}</p>
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <MarkReadButton id={sub.id} isRead={sub.isRead} />
                  <a
                    href={`mailto:${sub.email}?subject=Re: ${encodeURIComponent(sub.subject)}`}
                    className="text-sm text-lions-blue hover:text-lions-blue-dark font-medium"
                  >
                    Reply
                  </a>
                </div>
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
