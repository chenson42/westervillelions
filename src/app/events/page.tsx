import type { Metadata } from "next";
import Image from "next/image";
import { db } from "@/lib/db";
import { events, eventOccurrenceOverrides } from "@/lib/db/schema";
import { and, eq, or, gt, isNull } from "drizzle-orm";
import { format } from "date-fns";
import Link from "next/link";
import { formatRecurrence, getNextOccurrence, formatEventWhen, dateKey, buildGoogleCalendarUrl, buildOutlookCalendarUrl, type IcsEventInput } from "@/lib/events";
import MarkdownContent from "@/components/markdown-content";
import { AddToCalendarDropdown } from "@/components/events/add-to-calendar-dropdown";

export const metadata: Metadata = {
  title: "Upcoming Events",
  description:
    "Find upcoming events and service projects hosted by the Westerville Lions Club in Westerville, Ohio. All are welcome — come see what Lions service is all about.",
  alternates: {
    canonical: "https://westervillelions.org/events",
  },
  openGraph: {
    title: "Upcoming Events | Westerville Lions Club",
    description:
      "Find upcoming events and service projects hosted by the Westerville Lions Club in Westerville, Ohio. All are welcome.",
    url: "https://westervillelions.org/events",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club Events",
      },
    ],
  },
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
  const now = new Date();
  // Drizzle mode:"string" columns require string comparisons in WHERE clauses.
  const nowStr = format(now, "yyyy-MM-dd HH:mm:ss");

  // Include future one-time events AND active recurring series
  const [rawEvents, allOverrides] = await Promise.all([
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.isPublic, true),
          or(
            gt(events.startDate, nowStr),
            and(
              eq(events.isRecurring, true),
              or(isNull(events.recurrenceEndDate), gt(events.recurrenceEndDate, nowStr))
            )
          )
        )
      ),
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

  const siteUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";

  // Sort by next occurrence so recurring series appear at the right position
  const publicEvents = rawEvents
    .map((event) => {
      const nextOccurrence = getNextOccurrence(event, now, cancelledByEvent.get(event.id) ?? new Set());
      if (!nextOccurrence) return { ...event, nextOccurrence: null, googleUrl: null as string | null, outlookUrl: null as string | null };
      const icsInput: IcsEventInput = {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        isAllDay: event.isAllDay,
        startDate: event.startDate,
        endDate: event.endDate,
        isPublic: event.isPublic,
        url: `${siteUrl}/events/${event.id}`,
      };
      return {
        ...event,
        nextOccurrence,
        googleUrl: buildGoogleCalendarUrl(icsInput, nextOccurrence),
        outlookUrl: buildOutlookCalendarUrl(icsInput, nextOccurrence),
      };
    })
    .filter((event) => event.nextOccurrence !== null)
    .sort((a, b) => a.nextOccurrence!.getTime() - b.nextOccurrence!.getTime());

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
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
            {publicEvents.length > 0 ? (
              <div className="space-y-6">
                {publicEvents.map((event) => {
                  const recurrenceLabel = formatRecurrence(event);
                  return (
                    <div key={event.id} className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition transform hover:-translate-y-1">
                      {event.image && (
                        <Link href={`/events/${event.id}`} className="block relative w-full aspect-[7/2]">
                          <Image
                            src={event.image}
                            alt={event.title}
                            fill
                            className="object-cover"
                            sizes="(max-width: 768px) 100vw, 896px"
                            unoptimized={event.image.startsWith("http")}
                          />
                        </Link>
                      )}
                      <div className="p-6">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Link href={`/events/${event.id}`} className="group flex items-center gap-2 hover:text-lions-blue transition">
                            <h3 className="text-2xl font-semibold text-gray-900 group-hover:text-lions-blue transition">
                              {event.title}
                            </h3>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-lions-blue flex-shrink-0 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                          </Link>
                          {event.isRecurring && (
                            <span className="inline-block rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-medium text-lions-blue">
                              Recurring
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-gray-600 mb-3">
                          <span className="font-medium">
                            {recurrenceLabel ?? formatEventWhen(event)}
                          </span>
                          {event.location && (
                            <>
                              <span className="mx-1">·</span>
                              <span>{event.location}</span>
                            </>
                          )}
                        </div>
                        {event.description && (
                          <MarkdownContent className="text-gray-700">
                            {event.description}
                          </MarkdownContent>
                        )}
                        <div className="mt-4">
                          <AddToCalendarDropdown
                            eventId={event.id}
                            occurrence={dateKey(event.nextOccurrence!)}
                            googleUrl={event.googleUrl}
                            outlookUrl={event.outlookUrl}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
                <p className="text-xl text-gray-600 mb-3">
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
