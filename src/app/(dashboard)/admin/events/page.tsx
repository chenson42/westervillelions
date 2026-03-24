import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import Link from "next/link";
import { asc, desc, gte, lt, and, sql } from "drizzle-orm";

const PAGE_SIZE = 20;

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const { page: pageParam = "1", view = "upcoming" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam) || 1);
  const isPast = view === "past";
  const now = new Date();

  const condition = isPast ? lt(events.startDate, now) : gte(events.startDate, now);
  const order = isPast ? desc(events.startDate) : asc(events.startDate);

  const [eventList, [{ count }]] = await Promise.all([
    db
      .select()
      .from(events)
      .where(condition)
      .orderBy(order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(condition),
  ]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (view !== "upcoming") params.set("view", view);
    if (p > 1) params.set("page", String(p));
    return `/admin/events${params.size > 0 ? `?${params}` : ""}`;
  }

  function viewUrl(v: string) {
    return `/admin/events${v !== "upcoming" ? `?view=${v}` : ""}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          <p className="mt-2 text-gray-600">Manage club events and meetings</p>
        </div>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark"
        >
          New Event
        </Link>
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <Link
          href={viewUrl("upcoming")}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            !isPast
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href={viewUrl("past")}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            isPast
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Past
        </Link>
      </div>

      {/* Events table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Event
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Location
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Visibility
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {eventList.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <div className="text-gray-500">
                    <p className="text-lg font-medium">No {isPast ? "past" : "upcoming"} events</p>
                    {!isPast && (
                      <p className="mt-1 text-sm">Create your first event to get started</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              eventList.map((event) => (
                <tr key={event.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{event.title}</div>
                    {event.description && (
                      <div className="mt-1 text-sm text-gray-500 line-clamp-1">
                        {event.description}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {new Date(event.startDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {event.location || "—"}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                        event.isPublic
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {event.isPublic ? "Public" : "Members only"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="text-lions-blue hover:text-lions-blue-dark"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-700">
          <p>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} of {count} events
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageUrl(page - 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageUrl(page + 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="text-sm text-gray-500">
        {count} {isPast ? "past" : "upcoming"} event{count !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
