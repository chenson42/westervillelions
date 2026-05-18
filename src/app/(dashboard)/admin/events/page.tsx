import { db } from "@/lib/db";
import { events, eventRsvps, eventOccurrenceOverrides } from "@/lib/db/schema";
import Link from "next/link";
import { and, eq, gte, isNotNull, isNull, lt, or, sql, inArray } from "drizzle-orm";
import { EventTableRow, type RsvpSummary } from "@/components/admin/event-table-row";
import { getNextOccurrence, parseWallClock } from "@/lib/events";
import { format } from "date-fns";


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
  // Drizzle mode:"string" columns require string comparisons in WHERE clauses.
  const nowStr = format(now, "yyyy-MM-dd HH:mm:ss");

  // A recurring series is "upcoming" while it has no end date or its end date
  // hasn't passed yet. "Past" is the inverse — non-recurring events whose
  // startDate is in the past, plus recurring series whose recurrenceEndDate is
  // in the past. Filtering by startDate alone would wrongly classify an active
  // recurring series as past just because the series began long ago.
  const condition = isPast
    ? or(
        and(eq(events.isRecurring, false), lt(events.startDate, nowStr)),
        and(
          eq(events.isRecurring, true),
          isNotNull(events.recurrenceEndDate),
          lt(events.recurrenceEndDate, nowStr)
        )
      )
    : or(
        and(eq(events.isRecurring, false), gte(events.startDate, nowStr)),
        and(
          eq(events.isRecurring, true),
          or(isNull(events.recurrenceEndDate), gte(events.recurrenceEndDate, nowStr))
        )
      );

  const [matchingEvents, allOverrides] = await Promise.all([
    db.select().from(events).where(condition),
    db
      .select({
        eventId: eventOccurrenceOverrides.eventId,
        occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
      })
      .from(eventOccurrenceOverrides),
  ]);

  // Build a per-event cancelled date set for getNextOccurrence to skip
  const cancelledByEvent = new Map<string, Set<string>>();
  for (const o of allOverrides) {
    if (!cancelledByEvent.has(o.eventId)) cancelledByEvent.set(o.eventId, new Set());
    cancelledByEvent.get(o.eventId)!.add(o.occurrenceDate);
  }

  // Sort by actual next-occurrence date (cancellation-aware) for upcoming;
  // for past, sort by the most recent occurrence date (last day of the series
  // for recurring; startDate for non-recurring), descending. SQL pagination by
  // startDate alone would put recurring series whose startDate is old at the
  // top of the upcoming list, which doesn't match user expectation.
  const annotated = matchingEvents
    .map((event) => {
      const cancelled = cancelledByEvent.get(event.id) ?? new Set<string>();
      const next = getNextOccurrence(event, now, cancelled);
      // lastDate is now a wall-clock string; parse to Date for sort comparison.
      const lastDateStr = event.isRecurring
        ? (event.recurrenceEndDate ?? event.startDate)
        : event.startDate;
      const lastDate = parseWallClock(lastDateStr);
      return { event, next, lastDate };
    })
    // Upcoming events with no next occurrence (e.g., every remaining date is
    // cancelled) get filtered out so the row doesn't claim a date that isn't
    // happening. Past events keep all matching rows.
    .filter((row) => (isPast ? true : row.next !== null))
    .sort((a, b) => {
      if (isPast) return b.lastDate.getTime() - a.lastDate.getTime();
      return (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity);
    });

  const count = annotated.length;
  const totalPages = Math.ceil(count / PAGE_SIZE);
  const eventList = annotated
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((row) => row.event);

  const rsvpEventIds = eventList.filter((e) => e.requiresRsvp).map((e) => e.id);

  const rsvpRows = rsvpEventIds.length > 0
    ? await db
        .select({
          eventId: eventRsvps.eventId,
          status: eventRsvps.status,
          occurrenceDate: eventRsvps.occurrenceDate,
          count: sql<number>`count(*)::int`,
        })
        .from(eventRsvps)
        .where(inArray(eventRsvps.eventId, rsvpEventIds))
        .groupBy(eventRsvps.eventId, eventRsvps.status, eventRsvps.occurrenceDate)
    : [];

  // For recurring events, the row's count should reflect just the next upcoming
  // occurrence, not every future occurrence summed together. Compute the target
  // date per event; null means "count all rows" (non-recurring, or recurring
  // series that has ended).
  const occurrenceFilter = new Map<string, string | null>();
  for (const event of eventList) {
    if (!event.requiresRsvp) continue;
    if (!event.isRecurring) {
      occurrenceFilter.set(event.id, null);
      continue;
    }
    const next = getNextOccurrence(
      {
        isRecurring: event.isRecurring,
        startDate: event.startDate,
        recurrenceType: event.recurrenceType,
        recurrenceDays: event.recurrenceDays,
        recurrenceEndDate: event.recurrenceEndDate,
      },
      now,
      cancelledByEvent.get(event.id) ?? new Set()
    );
    occurrenceFilter.set(event.id, next ? format(next, "yyyy-MM-dd") : null);
  }

  const rsvpMap = new Map<string, RsvpSummary>();
  for (const row of rsvpRows) {
    const targetDate = occurrenceFilter.get(row.eventId);
    if (targetDate) {
      // occurrenceDate is now a wall-clock string "YYYY-MM-DD HH:MM:SS"; slice for date portion.
      const rowDate = row.occurrenceDate
        ? row.occurrenceDate.slice(0, 10)
        : null;
      if (rowDate !== targetDate) continue;
    }
    const s = rsvpMap.get(row.eventId) ?? { attending: 0, maybe: 0, declined: 0, total: 0 };
    if (row.status === "attending") s.attending += row.count;
    else if (row.status === "maybe") s.maybe += row.count;
    else if (row.status === "declined") s.declined += row.count;
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
