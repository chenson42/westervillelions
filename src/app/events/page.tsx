import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";

export default async function WhatWeDoPage() {
  // Fetch public events
  const publicEvents = await db.query.events.findMany({
    where: eq(events.isPublic, true),
    orderBy: (events, { desc }) => [desc(events.startDate)],
  });

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">What We Do</h1>
          <p className="text-xl">Serving our community through action and partnership</p>
        </div>
      </div>

      {/* Service Areas Overview */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            <div className="bg-white border-2 border-lions-gold rounded-xl p-6">
              <h3 className="text-2xl font-bold mb-4 text-lions-blue">Community Service</h3>
              <p className="text-gray-700 leading-relaxed">
                We partner with local organizations to address community needs through food drives,
                holiday programs, and support for families in our area.
              </p>
            </div>
            <div className="bg-white border-2 border-lions-gold rounded-xl p-6">
              <h3 className="text-2xl font-bold mb-4 text-lions-blue">Vision Care</h3>
              <p className="text-gray-700 leading-relaxed">
                Supporting vision health through eye screenings, glasses collection programs,
                and partnerships that provide eye care services to those in need.
              </p>
            </div>
            <div className="bg-white border-2 border-lions-gold rounded-xl p-6">
              <h3 className="text-2xl font-bold mb-4 text-lions-blue">Youth Development</h3>
              <p className="text-gray-700 leading-relaxed">
                Investing in tomorrow's leaders through scholarships, educational programs,
                and youth activity support in our community.
              </p>
            </div>
            <div className="bg-white border-2 border-lions-gold rounded-xl p-6">
              <h3 className="text-2xl font-bold mb-4 text-lions-blue">Humanitarian Aid</h3>
              <p className="text-gray-700 leading-relaxed">
                Providing disaster relief and emergency assistance to those facing hardship
                both locally and through international Lions programs.
              </p>
            </div>
          </div>

          {/* Upcoming Events Section */}
          <div className="mb-16">
            <h2 className="text-3xl font-bold mb-8 text-gray-900 text-center">Upcoming Events</h2>
            {publicEvents.length > 0 ? (
              <div className="space-y-6">
                {publicEvents.map((event) => (
                  <div key={event.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition">
                    {event.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={event.image}
                        alt={event.title}
                        className="w-full h-64 object-cover"
                      />
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
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-xl text-gray-600 mb-6">
                  No upcoming public events at this time.
                </p>
                <p className="text-gray-600">
                  Check back soon for announcements about our next service projects and community events.
                </p>
              </div>
            )}
          </div>

          {/* Get Involved CTA */}
          <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white p-8 rounded-xl text-center">
            <h2 className="text-3xl font-bold mb-4">Join Us in Service</h2>
            <p className="text-lg mb-6">
              Many of our service projects and events are open to guests and prospective members.
              Come see what Lions service is all about!
            </p>
            <a
              href="/contact"
              className="inline-block bg-lions-gold text-lions-blue-dark px-8 py-3 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition"
            >
              Contact Us to Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
