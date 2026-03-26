import type { Metadata } from "next";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { format } from "date-fns";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Upcoming Events",
  description:
    "Find upcoming events and service projects hosted by the Westerville Lions Club in Westerville, Ohio. All are welcome — come see what Lions service is all about.",
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Events", item: "https://westervillelions.org/events" },
  ],
};

export default async function WhatWeDoPage() {
  const publicEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.isPublic, true), gte(events.startDate, new Date())))
    .orderBy(events.startDate);

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-lions-gold font-semibold uppercase tracking-widest text-sm mb-4">
            Get Involved
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Upcoming Events</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            Serving our community through action and partnership — come join us at our next event.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">

          {/* Upcoming Events — primary content */}
          <div className="mb-16">
            <h2 className="text-3xl font-bold mb-8 text-gray-900">Upcoming Events</h2>
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
                <p className="text-xl text-gray-600 mb-3">
                  No upcoming public events at this time.
                </p>
                <p className="text-gray-600">
                  Check back soon for announcements about our next service projects and community events.
                </p>
              </div>
            )}
          </div>

          {/* Service areas — secondary context */}
          <div className="mb-16">
            <h2 className="text-3xl font-bold mb-3 text-gray-900">Our Service Areas</h2>
            <p className="text-gray-600 mb-8">
              Lions service spans a broad range of humanitarian causes — locally and globally.{" "}
              <Link href="/mission" className="text-lions-blue hover:underline font-medium">
                Learn more about our mission.
              </Link>
            </p>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                {
                  title: "Community Service",
                  body: "Food drives, holiday programs, and hands-on support for families in Westerville.",
                },
                {
                  title: "Youth Development",
                  body: "Scholarships, educational programs, and youth leadership opportunities.",
                },
                {
                  title: "Humanitarian Aid",
                  body: "Disaster relief and emergency assistance locally and through Lions International.",
                },
              ].map((area) => (
                <div key={area.title} className="border border-gray-200 rounded-xl p-6 hover:border-lions-blue/40 hover:shadow-sm transition">
                  <h3 className="text-lg font-semibold mb-2 text-lions-blue">{area.title}</h3>
                  <p className="text-gray-700 text-sm leading-relaxed">{area.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Get Involved CTA */}
          <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white p-8 rounded-xl text-center">
            <h2 className="text-3xl font-bold mb-4">Join Us in Service</h2>
            <p className="text-lg mb-6">
              Many of our service projects and events are open to guests and prospective members.
              Come see what Lions service is all about!
            </p>
            <Link
              href="/join"
              className="inline-block bg-lions-gold text-lions-blue-dark px-8 py-3 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition"
            >
              Apply for Membership
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
