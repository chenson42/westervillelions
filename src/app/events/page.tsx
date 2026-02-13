import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import Image from "next/image";

export default async function EventsPage() {
  // Fetch public events
  const publicEvents = await db.query.events.findMany({
    where: eq(events.isPublic, true),
    orderBy: (events, { desc }) => [desc(events.startDate)],
  });

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-red text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Events</h1>
          <p className="text-xl">Join us in serving our community</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {publicEvents.length > 0 ? (
            <div className="space-y-6">
              {publicEvents.map((event) => (
                <div key={event.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition">
                  {event.image && (
                    <div className="relative w-full h-64">
                      <Image
                        src={event.image}
                        alt={event.title}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    <h3 className="text-2xl font-semibold mb-2 text-gray-900">
                      {event.title}
                    </h3>
                    <div className="flex items-center text-gray-600 mb-3">
                      <span className="font-medium">
                        {format(new Date(event.startDate), "MMMM d, yyyy")} at{" "}
                        {format(new Date(event.startDate), "h:mm a")}
                      </span>
                      {event.location && (
                        <>
                          <span className="mx-2">•</span>
                          <span>{event.location}</span>
                        </>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-gray-700">{event.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600 mb-6">
                No upcoming public events at this time.
              </p>
              <p className="text-gray-600">
                Check back soon or{" "}
                <a href="/contact" className="text-lions-red hover:underline">
                  contact us
                </a>{" "}
                for more information about our activities.
              </p>
            </div>
          )}

          <div className="mt-12 bg-gray-50 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">
              Get Involved
            </h2>
            <p className="text-lg text-gray-700 mb-6">
              Many of our service projects and social events are open to guests and
              prospective members. Come see what we're all about!
            </p>
            <a
              href="/contact"
              className="inline-block bg-lions-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-red-dark transition"
            >
              Contact Us to Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
