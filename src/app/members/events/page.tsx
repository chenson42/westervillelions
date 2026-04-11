import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { events, eventRsvps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { EventRsvp } from "@/components/members/event-rsvp";
import MarkdownContent from "@/components/markdown-content";

export default async function MemberEventsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const allEvents = await db.query.events.findMany({
    orderBy: (events, { asc }) => [asc(events.startDate)],
  });

  // Fetch current user's RSVPs
  const userRsvps = session.user.id
    ? await db.query.eventRsvps.findMany({
        where: eq(eventRsvps.userId, session.user.id),
      })
    : [];

  const rsvpByEvent = new Map(userRsvps.map((r) => [r.eventId, r.status]));

  const now = new Date();
  const upcoming = allEvents.filter((e) => new Date(e.startDate) >= now);
  const past = allEvents.filter((e) => new Date(e.startDate) < now);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-blue text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Club Events</h1>
          <p className="text-xl">View and RSVP to upcoming events</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={event.image} alt={event.title} className="w-full aspect-video object-cover" />
                )}
                <div className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 mb-1">{event.title}</h3>
                      <p className="text-gray-600 text-sm mb-1">
                        {format(new Date(event.startDate), "EEEE, MMMM d, yyyy")} at{" "}
                        {format(new Date(event.startDate), "h:mm a")}
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
                    <div className="shrink-0">
                      <EventRsvp
                        eventId={event.id}
                        initialStatus={(rsvpByEvent.get(event.id) ?? null) as "attending" | "maybe" | "declined" | null}
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
                <div key={event.id} className="bg-white rounded-2xl shadow-sm p-4 opacity-75">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-gray-700">{event.title}</h3>
                      <p className="text-sm text-gray-500">
                        {format(new Date(event.startDate), "MMMM d, yyyy")}
                        {event.location && ` · ${event.location}`}
                      </p>
                    </div>
                    {rsvpByEvent.get(event.id) && (
                      <span className="text-xs text-gray-500 capitalize">
                        {rsvpByEvent.get(event.id)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
