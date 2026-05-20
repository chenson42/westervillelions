import { unstable_noStore as noStore } from "next/cache";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { eventRsvps, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format, subMonths } from "date-fns";
import Link from "next/link";
import MarkdownContent from "@/components/markdown-content";
import { getNextOccurrence, parseWallClock, formatEventWhen, dateKey, buildGoogleCalendarUrl, buildOutlookCalendarUrl, type IcsEventInput } from "@/lib/events";
import { AddToCalendarDropdown } from "@/components/events/add-to-calendar-dropdown";

export default async function MemberEventsPage() {
  noStore();
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const [allEvents, userRsvps, allOverrides] = await Promise.all([
    db.query.events.findMany(),
    session.user.id
      ? db.query.eventRsvps.findMany({ where: eq(eventRsvps.userId, session.user.id) })
      : Promise.resolve([]),
    db
      .select({
        eventId: eventOccurrenceOverrides.eventId,
        occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
      })
      .from(eventOccurrenceOverrides),
  ]);

  const rsvpByEvent = new Map(userRsvps.map((r) => [r.eventId, r.status]));

  const now = new Date();
  const sixMonthsAgo = subMonths(now, 6);

  // Build a per-event cancelled date set for getNextOccurrence to skip
  const cancelledByEvent = new Map<string, Set<string>>();
  for (const o of allOverrides) {
    if (!cancelledByEvent.has(o.eventId)) cancelledByEvent.set(o.eventId, new Set());
    cancelledByEvent.get(o.eventId)!.add(o.occurrenceDate);
  }

  const siteUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";

  const enriched = allEvents.map((e) => {
    const nextOccurrence = getNextOccurrence(e, now, cancelledByEvent.get(e.id) ?? new Set());
    if (!nextOccurrence) {
      return { ...e, nextOccurrence: null, googleUrl: null as string | null, outlookUrl: null as string | null };
    }
    const icsInput: IcsEventInput = {
      id: e.id,
      title: e.title,
      description: e.description,
      location: e.location,
      isAllDay: e.isAllDay,
      startDate: e.startDate,
      endDate: e.endDate,
      isPublic: e.isPublic,
      url: `${siteUrl}/events/${e.id}`,
    };
    return {
      ...e,
      nextOccurrence,
      googleUrl: buildGoogleCalendarUrl(icsInput, nextOccurrence),
      outlookUrl: buildOutlookCalendarUrl(icsInput, nextOccurrence),
    };
  });

  const upcoming = enriched
    .filter((e) => e.nextOccurrence !== null)
    .sort((a, b) => a.nextOccurrence!.getTime() - b.nextOccurrence!.getTime());

  const pastAll = enriched
    .filter((e) => e.nextOccurrence === null)
    .map((e) => ({
      ...e,
      effectiveEnd: parseWallClock(e.recurrenceEndDate ?? e.startDate),
    }))
    .sort((a, b) => b.effectiveEnd.getTime() - a.effectiveEnd.getTime());

  const past = pastAll.filter((e) => e.effectiveEnd >= sixMonthsAgo);
  const hasOlderPast = pastAll.length > past.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-blue text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Club Events</h1>
          <p className="text-xl">View and RSVP to upcoming events</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-6">
          <a href="/members" className="text-lions-blue hover:underline">
            ← Back to Member Portal
          </a>
        </div>

        {/* Upcoming Events */}
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Upcoming Events</h2>
        {upcoming.length > 0 ? (
          <div className="space-y-4 mb-10">
            {upcoming.map((event) => (
              <div key={event.id} className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition transform hover:-translate-y-1">
                {event.image && (
                  <Link href={`/events/${event.id}`} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={event.image} alt={event.title} className="w-full aspect-[7/2] object-cover" />
                  </Link>
                )}
                <div className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1">
                      <Link href={`/events/${event.id}`} className="group inline-flex items-center gap-2 hover:text-lions-blue transition mb-1">
                        <h3 className="text-xl font-semibold text-gray-900 group-hover:text-lions-blue transition">{event.title}</h3>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-lions-blue flex-shrink-0 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </Link>
                      <p className="text-gray-600 text-sm mb-1">
                        {formatEventWhen(event)}
                      </p>
                      {event.location && (
                        <p className="text-gray-600 text-sm mb-2">{event.location}</p>
                      )}
                      {event.description && (
                        <MarkdownContent className="text-gray-700 text-sm">
                          {event.description}
                        </MarkdownContent>
                      )}
                      {event.maxAttendees && (
                        <p className="text-xs text-gray-500 mt-1">
                          Capacity: {event.maxAttendees} attendees
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {rsvpByEvent.get(event.id) && (
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                          rsvpByEvent.get(event.id) === "attending"
                            ? "bg-green-100 text-green-800"
                            : rsvpByEvent.get(event.id) === "maybe"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {rsvpByEvent.get(event.id)}
                        </span>
                      )}
                      {event.requiresRsvp && (
                        <Link
                          href={`/events/${event.id}`}
                          className="bg-lions-blue text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition"
                        >
                          {rsvpByEvent.get(event.id) ? "Update RSVP" : "RSVP"}
                        </Link>
                      )}
                      <AddToCalendarDropdown
                        eventId={event.id}
                        occurrence={dateKey(event.nextOccurrence!)}
                        googleUrl={event.googleUrl}
                        outlookUrl={event.outlookUrl}
                      />
                    </div>
                  </div>
                  {event.isPublic && (
                    <span className="inline-block mt-3 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                      Public Event
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 mb-10">
            No upcoming events scheduled.
          </div>
        )}

        {/* Past Events */}
        {past.length > 0 && (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Past Events</h2>
            <div className="space-y-3">
              {past.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="block bg-white rounded-2xl shadow-sm p-4 hover:shadow-md transition opacity-75 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  <div className="flex justify-between items-center gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-700 truncate">{event.title}</h3>
                      <p className="text-sm text-gray-500">
                        {format(event.effectiveEnd, "MMMM d, yyyy")}
                        {event.location && ` · ${event.location}`}
                      </p>
                    </div>
                    {rsvpByEvent.get(event.id) && (
                      <span className="text-xs text-gray-500 capitalize shrink-0">
                        {rsvpByEvent.get(event.id)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            {hasOlderPast && (
              <div className="mt-4">
                <Link
                  href="/members/events/past"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  See more past events
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
