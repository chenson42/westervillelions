import { db } from "@/lib/db";
import { events, eventRsvps } from "@/lib/db/schema";
import Link from "next/link";
import { asc, desc, gte, lt, and, sql, inArray } from "drizzle-orm";
import { EventTableRow, type RsvpSummary } from "@/components/admin/event-table-row";

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

  const rsvpEventIds = eventList.filter((e) => e.requiresRsvp).map((e) => e.id);

  const rsvpRows = rsvpEventIds.length > 0
    ? await db
        .select({
          eventId: eventRsvps.eventId,
          status: eventRsvps.status,
          count: sql<number>`count(*)::int`,
        })
        .from(eventRsvps)
        .where(inArray(eventRsvps.eventId, rsvpEventIds))
        .groupBy(eventRsvps.eventId, eventRsvps.status)
    : [];

  const rsvpMap = new Map<string, RsvpSummary>();
  for (const row of rsvpRows) {
    const s = rsvpMap.get(row.eventId) ?? { attending: 0, maybe: 0, declined: 0, total: 0 };
    if (row.status === "attending") s.attending = row.count;
    else if (row.status === "maybe") s.maybe = row.count;
    else if (row.status === "declined") s.declined = row.count;
    s.total += row.count;
    rsvpMap.set(row.eventId, s);
  }

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
        <div className="overflow-x-auto">
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
              eventList.map((event) => {
                const rsvpSummary = rsvpMap.get(event.id) ?? null;
                const defaultExpanded = !isPast && (rsvpSummary?.total ?? 0) > 0;
                return (
                  <EventTableRow
                    key={event.id}
                    event={event}
                    rsvpSummary={rsvpSummary}
                    defaultExpanded={defaultExpanded}
                  />
                );
              })
            )}
          </tbody>
        </table>
        </div>
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
