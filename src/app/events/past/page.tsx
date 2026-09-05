import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { events, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { getNextOccurrence, parseWallClock, nowEastern } from "@/lib/events";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Past Events",
  description:
    "An archive of past events and service projects hosted by the Westerville Lions Club in Westerville, Ohio.",
  alternates: {
    canonical: "https://westervillelions.org/events/past",
  },
  openGraph: {
    title: "Past Events | Westerville Lions Club",
    description:
      "An archive of past events and service projects hosted by the Westerville Lions Club in Westerville, Ohio.",
    url: "https://westervillelions.org/events/past",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/og-default.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club Events",
      },
    ],
  },
};

export default async function PastEventsPage() {
  // nowEastern(), not new Date(): see src/lib/events.ts nowEastern() doc comment.
  const now = nowEastern();

  const [allEvents, allOverrides] = await Promise.all([
    db.select().from(events).where(eq(events.isPublic, true)),
    db
      .select({
        eventId: eventOccurrenceOverrides.eventId,
        occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
      })
      .from(eventOccurrenceOverrides),
  ]);

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
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <Link
            href="/events"
            className="inline-flex items-center text-white/80 hover:text-white text-sm font-medium mb-6 transition focus:outline-none focus:ring-2 focus:ring-white rounded"
          >
            &larr; Upcoming Events
          </Link>
          <p className="text-lions-gold font-semibold uppercase tracking-widest text-sm mb-2">
            Our History
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">Past Events</h1>
          <p className="text-xl text-blue-100 max-w-2xl leading-relaxed">
            A look back at the service projects and gatherings our club has hosted.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16 max-w-4xl">
        {past.length > 0 ? (
          <div className="space-y-3">
            {past.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="block bg-white rounded-2xl shadow-sm hover:shadow-md transition p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <div className="flex justify-between items-center gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{event.title}</h3>
                    <p className="text-sm text-gray-500">
                      {format(event.effectiveEnd, "MMMM d, yyyy")}
                      {event.location && ` · ${event.location}`}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No past events to show yet.
          </div>
        )}
      </div>
    </div>
  );
}
