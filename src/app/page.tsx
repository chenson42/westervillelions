import type { Metadata } from "next";
import { ServiceCard } from "@/components/home/service-card";
import { ZeffyButton } from "@/components/campaigns/zeffy-button";
import FeaturedContent from "@/components/home/featured-content";
import { db } from "@/lib/db";
import { members, events, homepageAnnouncements, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq, count, gt, asc, lte, gte, isNull, or, and } from "drizzle-orm";
import { getNextOccurrence, parseWallClock, nowEastern } from "@/lib/events";
import { format } from "date-fns";

export const metadata: Metadata = {
  title: "Westerville Lions Club | Serving Westerville, OH Since 1928",
  description:
    "Westerville Lions Club — serving Westerville, Ohio since 1928 through youth programs, hunger relief, humanitarian aid, and hands-on community service.",
  alternates: {
    canonical: "https://westervillelions.org",
  },
  openGraph: {
    title: "Westerville Lions Club | Serving Westerville, OH Since 1928",
    description:
      "Serving Westerville, Ohio since 1928 through youth programs, hunger relief, humanitarian aid, and hands-on community service.",
    url: "https://westervillelions.org",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
};

const FOUNDING_YEAR = 1928;

export default async function HomePage() {
  // nowEastern(), not new Date(): the process runs in UTC on Vercel, and
  // reading new Date() through local-time accessors would compare against
  // the wrong wall-clock hour. See src/lib/events.ts nowEastern() doc comment.
  const now = nowEastern();
  // Drizzle mode:"string" columns require string comparisons in WHERE clauses.
  const nowStr = format(now, "yyyy-MM-dd HH:mm:ss");

  const eventCols = {
    id: events.id,
    title: events.title,
    startDate: events.startDate,
    isAllDay: events.isAllDay,
    location: events.location,
    description: events.description,
    image: events.image,
    isRecurring: events.isRecurring,
    recurrenceType: events.recurrenceType,
    recurrenceDays: events.recurrenceDays,
    recurrenceEndDate: events.recurrenceEndDate,
  };
  // Match future one-time events OR active recurring series (no end date, or end date still in future)
  const upcomingPublic = and(
    eq(events.isPublic, true),
    or(
      gt(events.startDate, nowStr),
      and(
        eq(events.isRecurring, true),
        or(isNull(events.recurrenceEndDate), gt(events.recurrenceEndDate, nowStr))
      )
    )
  );

  const [
    [{ value: memberCount }],
    featuredEventRows,
    fallbackEventRows,
    activeAnnouncementRows,
    allOverrides,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(members)
      .where(eq(members.isActive, true)),

    db
      .select(eventCols)
      .from(events)
      .where(and(upcomingPublic, eq(events.isFeatured, true)))
      .orderBy(asc(events.startDate))
      .limit(3),

    db
      .select(eventCols)
      .from(events)
      .where(upcomingPublic)
      .orderBy(asc(events.startDate))
      .limit(5),

    db
      .select()
      .from(homepageAnnouncements)
      .where(
        and(
          eq(homepageAnnouncements.isActive, true),
          or(
            isNull(homepageAnnouncements.startsAt),
            lte(homepageAnnouncements.startsAt, now)
          ),
          or(
            isNull(homepageAnnouncements.endsAt),
            gte(homepageAnnouncements.endsAt, now)
          )
        )
      )
      .orderBy(
        asc(homepageAnnouncements.sortOrder),
        asc(homepageAnnouncements.createdAt)
      )
      .limit(5),

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

  // Attach each row's next-occurrence Date (computed once, reused for both
  // sorting and display) so recurring events land in the right order AND
  // display the upcoming date rather than the series' original startDate.
  // startDate and recurrenceEndDate are wall-clock strings (mode:"string").
  type EventRow = {
    id: string;
    startDate: string;
    isRecurring: boolean;
    recurrenceType: string | null;
    recurrenceDays: number[] | null;
    recurrenceEndDate: string | null;
  };
  const withNextOccurrence = <T extends EventRow>(rows: T[]) =>
    rows.map((row) => ({
      ...row,
      // Non-recurring events: getNextOccurrence returns their own startDate,
      // so this is a no-op fallback for them. Only null when a recurring
      // series has ended (upcomingPublic already filters those out).
      nextOccurrence:
        getNextOccurrence(row, now, cancelledByEvent.get(row.id) ?? new Set()) ??
        parseWallClock(row.startDate),
    }));

  const sortByNextOccurrence = <T extends { nextOccurrence: Date }>(rows: T[]) =>
    [...rows].sort((a, b) => a.nextOccurrence.getTime() - b.nextOccurrence.getTime());

  const nextEvents = featuredEventRows.length > 0
    ? sortByNextOccurrence(withNextOccurrence(featuredEventRows))
    : sortByNextOccurrence(withNextOccurrence(fallbackEventRows)).slice(0, 1);
  const yearsOfService = new Date().getFullYear() - FOUNDING_YEAR;
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section with Background Image */}
      <section className="relative bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-24 md:py-32 overflow-hidden">
        {/* Background Image Overlay */}
        <div className="absolute inset-0 bg-black opacity-30"></div>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: 'url(/images/hero-bg.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        ></div>
        {/* Fallback gradient pattern if no image */}
        <div className="absolute inset-0 bg-gradient-to-br from-lions-blue/90 to-lions-blue-dark/90"></div>

        <div className="container mx-auto px-4 text-center relative z-10">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 drop-shadow-lg">
            Westerville Lions Club
          </h1>
          <p className="text-2xl md:text-3xl mb-8 font-light">
            Serving Our Community Since 1928
          </p>
          <p className="text-xl md:text-2xl max-w-4xl mx-auto font-light leading-relaxed mb-10">
            Helping our community thrive through service and care.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/join"
              className="bg-lions-gold text-lions-blue-dark px-8 py-4 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition shadow-lg transform hover:scale-105"
            >
              Join the Club
            </a>
            <a
              href="/connect"
              aria-label="Find out when and where we meet"
              className="bg-transparent border-2 border-white text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-white hover:text-lions-blue transition"
            >
              Attend a Meeting
            </a>
          </div>
        </div>
      </section>

      {/* Impact Stats */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto text-center">
            <div className="p-6">
              <div className="text-5xl font-bold text-lions-blue mb-2">{yearsOfService}+</div>
              <p className="text-xl text-gray-700">Years of Service</p>
            </div>
            <div className="p-6">
              <div className="text-5xl font-bold text-lions-blue mb-2">{memberCount}</div>
              <p className="text-xl text-gray-700">Active Members</p>
            </div>
            <div className="p-6">
              <div className="text-5xl font-bold text-lions-blue mb-2">100%</div>
              <p className="text-xl text-gray-700">Community Focused</p>
            </div>
          </div>
        </div>
      </section>

      {/* Mission Section with Photos */}
      <section className="py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-gray-900">
            Our Service Areas
          </h2>
          <p className="text-center text-xl text-gray-600 mb-16 max-w-3xl mx-auto">
            We make a difference in our community through diverse service initiatives
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <ServiceCard
              image="/images/service-youth.jpg"
              alt="Youth Programs"
              title="Youth Programs"
              description="Supporting education, scholarships, and youth activities to empower the next generation"
              color="from-yellow-400 to-yellow-500"
              priority
            />
            <ServiceCard
              image="/images/service-community.jpg"
              alt="Community Service"
              title="Community Service"
              description="Partnering with local organizations to address pressing community needs"
              color="from-yellow-400 to-yellow-500"
            />
            <ServiceCard
              image="/images/service-humanitarian.jpg"
              alt="Humanitarian Aid"
              title="Humanitarian Aid"
              description="Providing disaster relief and support to those facing hardship"
              color="from-yellow-400 to-yellow-500"
            />
            <ServiceCard
              image="/images/service-community.jpg"
              alt="Environment"
              title="Environment"
              description="Protecting our community's natural resources through conservation efforts, clean-up events, and environmental education"
              color="from-yellow-400 to-yellow-500"
            />
            <ServiceCard
              image="/images/service-community.jpg"
              alt="Hunger Relief"
              title="Hunger Relief"
              description="Partnering with local food banks and meal programs to ensure no family in Westerville goes without nutritious food"
              color="from-yellow-400 to-yellow-500"
            />
          </div>
        </div>
      </section>

      {/* Stay Connected */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900">
              Stay Connected
            </h2>
            <p className="text-xl text-gray-600 mb-8">
              Follow our latest activities and stay connected with the community
            </p>
            {/* Social media links */}
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="https://www.facebook.com/WestervilleLions"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 text-gray-700 hover:border-lions-blue hover:text-lions-blue font-medium transition"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                Facebook
              </a>
              <a
                href="https://www.instagram.com/westervillelions"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 text-gray-700 hover:border-lions-blue hover:text-lions-blue font-medium transition"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
                </svg>
                Instagram
              </a>
              <a
                href="https://x.com/LionWesterville"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 text-gray-700 hover:border-lions-blue hover:text-lions-blue font-medium transition"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                </svg>
                X / Twitter
              </a>
            </div>
          </div>

          <FeaturedContent nextEvents={nextEvents} activeAnnouncements={activeAnnouncementRows} embedded />
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-lions-gold/20 to-lions-blue/10">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-gray-900">
            Ready to Make an Impact?
          </h2>
          <p className="text-xl text-gray-700 mb-10 max-w-2xl mx-auto">
            Join us in serving our community and making a lasting difference
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/campaigns"
              className="bg-lions-blue text-white px-10 py-4 rounded-lg font-bold text-lg hover:bg-lions-blue-dark transition shadow-lg transform hover:scale-105"
            >
              Support Our Mission
            </a>
            <a
              href="/connect"
              className="bg-white text-lions-blue border-2 border-lions-blue px-10 py-4 rounded-lg font-bold text-lg hover:bg-gray-50 transition shadow-lg"
            >
              Get in Touch
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
