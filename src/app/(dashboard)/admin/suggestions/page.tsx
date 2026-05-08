import { db } from "@/lib/db";
import { suggestions, users } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import SuggestionMarkReadButton from "@/components/admin/suggestion-mark-read-button";

const PAGE_SIZE = 25;

export default async function AdminSuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasFeature(session.user.id, FEATURES.SUGGESTIONS_VIEW);
  if (!canView) redirect("/admin");

  const { page: pageParam = "1", view = "unread" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam) || 1);
  const showAll = view === "all";

  const condition = showAll ? undefined : eq(suggestions.isRead, false);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: suggestions.id,
        category: suggestions.category,
        message: suggestions.message,
        isAnonymous: suggestions.isAnonymous,
        isRead: suggestions.isRead,
        handledBy: suggestions.handledBy,
        createdAt: suggestions.createdAt,
        userId: suggestions.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(suggestions)
      .leftJoin(users, eq(suggestions.userId, users.id))
      .where(condition)
      .orderBy(desc(suggestions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(suggestions)
      .where(condition),
  ]);

  const [{ unreadCount }] = await db
    .select({ unreadCount: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(eq(suggestions.isRead, false));

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (showAll) params.set("view", "all");
    if (p > 1) params.set("page", String(p));
    return `/admin/suggestions${params.size > 0 ? `?${params}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Suggestion Box</h1>
          <p className="mt-2 text-gray-600">
            Ideas submitted by members through the member portal
          </p>
        </div>
        {unreadCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-lions-blue px-3 py-1 text-sm font-semibold text-white">
            {unreadCount} unhandled
          </span>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <a
          href="/admin/suggestions"
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            !showAll
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Unhandled {unreadCount > 0 ? `(${unreadCount})` : ""}
        </a>
        <a
          href="/admin/suggestions?view=all"
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            showAll
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All
        </a>
      </div>

      {/* Suggestions */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow">
          <p className="text-lg font-medium text-gray-500">
            {showAll ? "No suggestions yet" : "No unhandled suggestions"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const submitterLabel = s.isAnonymous
              ? "Anonymous member"
              : s.userName ?? s.userEmail ?? "Member";
            const submitterEmail = s.isAnonymous ? null : s.userEmail;
            return (
              <div
                key={s.id}
                className={`rounded-lg border bg-white p-6 shadow-sm ${
                  s.isRead ? "border-gray-200" : "border-lions-blue"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      {!s.isRead && (
                        <span className="inline-flex h-2 w-2 rounded-full bg-lions-blue flex-shrink-0" />
                      )}
                      <h3 className="font-semibold text-gray-900">{s.category}</h3>
                      {s.isAnonymous && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Anonymous
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3 flex-wrap">
                      <span className="font-medium text-gray-700">{submitterLabel}</span>
                      {submitterEmail && (
                        <>
                          <span>·</span>
                          <a href={`mailto:${submitterEmail}`} className="hover:text-lions-blue">
                            {submitterEmail}
                          </a>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {new Date(s.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.message}</p>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-2">
                    <SuggestionMarkReadButton
                      id={s.id}
                      isRead={s.isRead}
                      handledBy={s.handledBy ?? null}
                    />
                    {submitterEmail && (
                      <a
                        href={`mailto:${submitterEmail}?subject=Re: Suggestion - ${encodeURIComponent(s.category)}`}
                        className="text-sm text-lions-blue hover:text-lions-blue-dark font-medium"
                      >
                        Reply
                      </a>
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
