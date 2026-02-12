import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { format } from "date-fns";

export default async function MemberEventsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const allEvents = await db.query.events.findMany({
    orderBy: (events, { desc }) => [desc(events.startDate)],
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-red text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Club Events</h1>
          <p className="text-xl">View and RSVP to upcoming events</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <a
            href="/members"
            className="text-lions-red hover:underline"
          >
            ← Back to Member Portal
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          {allEvents.length > 0 ? (
            <div className="space-y-6">
              {allEvents.map((event) => (
                <div key={event.id} className="border border-gray-200 rounded-lg p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                        {event.title}
                      </h3>
                      <div className="flex items-center text-gray-600 mb-2">
                        <span className="font-medium">
                          {format(new Date(event.startDate), "EEEE, MMMM d, yyyy")} at{" "}
                          {format(new Date(event.startDate), "h:mm a")}
                        </span>
                      </div>
                      {event.location && (
                        <p className="text-gray-600">
                          <span className="font-medium">Location:</span> {event.location}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {event.isPublic && (
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                          Public Event
                        </span>
                      )}
                    </div>
                  </div>
                  {event.description && (
                    <p className="text-gray-700 mb-4">{event.description}</p>
                  )}
                  {event.maxAttendees && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Capacity:</span> {event.maxAttendees} attendees
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600">No events scheduled at this time.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
