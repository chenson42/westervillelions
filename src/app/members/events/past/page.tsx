import { unstable_noStore as noStore } from "next/cache";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { eventRsvps, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import Link from "next/link";
import { getNextOccurrence, parseWallClock } from "@/lib/events";

export default async function MemberPastEventsPage() {
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

  // Build a per-event cancelled date set for getNextOccurrence to skip
  const cancelledByEvent = new Map<string, Set<string>>();
  for (const o of allOverrides) {
    if (!cancelledByEvent.has(o.eventId)) cancelledByEvent.set(o.eventId, new Set());
    cancelledByEvent.get(o.eventId)!.add(o.occurrenceDate);
  }

  const past = allEvents
    .map((e) => ({
      ...e,
      nextOccurrence: getNextOccurrence(e, now, cancelledByEvent.get(e.id) ?? new Set()),
    }))
    .filter((e) => e.nextOccurrence === null)
    .map((e) => ({
      ...e,
      effectiveEnd: parseWallClock(e.recurrenceEndDate ?? e.startDate),
    }))
    .sort((a, b) => b.effectiveEnd.getTime() - a.effectiveEnd.getTime());

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-blue text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Past Events</h1>
          <p className="text-xl">Archive of all past club events</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-6">
          <Link href="/members/events" className="text-lions-blue hover:underline">
            &larr; Back to Events
          </Link>
        </div>

        {past.length > 0 ? (
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
        ) : (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No past events to show.
          </div>
        )}
      </div>
    </div>
  );
}
