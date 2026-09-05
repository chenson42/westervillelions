import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { glassesDropoffLocations, plasticDropoffLocations } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Community Programs",
  description:
    "Learn about the Westerville Lions Club community drop-off programs — donate gently used eyeglasses and recycle plastic film to make a difference close to home.",
  alternates: {
    canonical: "https://westervillelions.org/programs",
  },
  openGraph: {
    title: "Community Programs | Westerville Lions Club",
    description:
      "Learn about the Westerville Lions Club community drop-off programs — donate gently used eyeglasses and recycle plastic film to make a difference close to home.",
    url: "https://westervillelions.org/programs",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/og-default.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Programs", item: "https://westervillelions.org/programs" },
  ],
};

type DropoffLocation = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  entryInstructions?: string | null;
  hours?: string | null;
};

/**
 * A single drop-off location with its own "Map" / "Call" action row.
 * Each action is a full 44px-tall, padded touch target — the mis-tap this
 * replaces was a bare 14x14px pin icon crammed next to a phone link
 * (site-review batch 4, 2026-09-04). Actions wrap onto their own row on
 * narrow screens and sit inline (still padded) on wider ones.
 */
function LocationEntry({ location }: { location: DropoffLocation }) {
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
  const telHref = location.phone ? `tel:${location.phone.replace(/[^0-9+]/g, "")}` : null;

  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="font-medium text-gray-900">{location.name}</span>
          <span className="text-gray-500"> &mdash; {location.address}</span>
        </div>
        <div className="flex items-center -mr-2 flex-shrink-0">
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${location.address} in Google Maps`}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg font-medium text-lions-blue hover:bg-lions-blue/10 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
            Map
          </a>
          {telHref && (
            <a
              href={telHref}
              aria-label={`Call ${location.name} at ${location.phone}`}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg font-medium text-lions-blue hover:bg-lions-blue/10 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 002.25-2.25v-1.372a1.5 1.5 0 00-1.148-1.457l-4.13-1.033a1.5 1.5 0 00-1.55.44l-.884 1.03a11.25 11.25 0 01-5.393-5.393l1.03-.884a1.5 1.5 0 00.44-1.55L8.782 5.15a1.5 1.5 0 00-1.457-1.15H5.25A2.25 2.25 0 003 6.25z" />
              </svg>
              Call
            </a>
          )}
        </div>
      </div>
      {location.entryInstructions && (
        <p className="text-gray-500 mt-0.5">{location.entryInstructions}</p>
      )}
      {location.hours && <p className="text-gray-500 mt-0.5">{location.hours}</p>}
    </li>
  );
}

export default async function ProgramsPage() {
  const [dropoffLocations, plasticLocations] = await Promise.all([
    db
      .select()
      .from(glassesDropoffLocations)
      .where(eq(glassesDropoffLocations.isActive, true))
      .orderBy(asc(glassesDropoffLocations.sortOrder), asc(glassesDropoffLocations.name)),
    db
      .select()
      .from(plasticDropoffLocations)
      .where(eq(plasticDropoffLocations.isActive, true))
      .orderBy(asc(plasticDropoffLocations.sortOrder), asc(plasticDropoffLocations.name)),
  ]);

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2 font-semibold">
            Community Programs
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Ways to Give Back</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            Small actions add up to big change. Our drop-off programs make it easy for Westerville
            neighbors to contribute — no special skills required, just a willingness to help.
          </p>
        </div>
      </div>

      {/* Program cards */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8">

            {/* Eyeglass Donation */}
            <article className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden flex flex-col">
              <div className="bg-lions-blue/5 px-8 pt-8 pb-6 flex items-start gap-4">
                <div className="flex-shrink-0 w-14 h-14 rounded-full bg-lions-blue/10 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-lions-blue"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 leading-tight">Donate Your Eyeglasses</h2>
                  <p className="text-sm text-lions-blue font-medium mt-1">Monthly collection</p>
                </div>
              </div>

              <div className="px-8 pb-8 flex flex-col flex-1 gap-6">
                <p className="text-gray-700 leading-relaxed">
                  The club collects gently used prescription eyeglasses and sunglasses each month, then
                  delivers them to The Ohio State University College of Optometry. From there, the
                  student organization{" "}
                  <strong className="text-gray-900">SVOSH</strong>{" "}
                  (Student Volunteer Optometric Services to Humanity) distributes them to individuals
                  in need around the world.
                </p>

                <div className="bg-blue-50 border border-lions-blue/20 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Drop-off Locations</h3>
                  {dropoffLocations.length === 0 ? (
                    <p className="text-sm text-gray-600">
                      Locations coming soon &mdash; check back shortly or{" "}
                      <Link
                        href="/connect"
                        className="text-lions-blue font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                      >
                        contact us
                      </Link>{" "}
                      for details.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {dropoffLocations.map((loc) => (
                        <LocationEntry key={loc.id} location={loc} />
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
                    What we accept
                  </h3>
                  <ul className="space-y-2">
                    {[
                      "Prescription eyeglasses (any prescription)",
                      "Reading glasses",
                      "Sunglasses in wearable condition",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                        <svg
                          className="w-4 h-4 text-lions-blue flex-shrink-0 mt-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
                    What we cannot accept
                  </h3>
                  <ul className="space-y-2">
                    {[
                      "Broken or bent frames",
                      "Heavily scratched or cracked lenses",
                      "Glasses with missing lenses",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                        <svg
                          className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

              </div>
            </article>

            {/* Plastic Film Recycling */}
            <article className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden flex flex-col">
              <div className="bg-lions-blue/5 px-8 pt-8 pb-6 flex items-start gap-4">
                <div className="flex-shrink-0 w-14 h-14 rounded-full bg-lions-blue/10 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-lions-blue"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 leading-tight">Recycle Plastic Film</h2>
                  <p className="text-sm text-lions-blue font-medium mt-1">Ongoing drop-off</p>
                </div>
              </div>

              <div className="px-8 pb-8 flex flex-col flex-1 gap-6">
                <p className="text-gray-700 leading-relaxed">
                  Most curbside recycling programs do not accept plastic film &mdash; it jams sorting
                  equipment and ends up in landfills. The club partners with local businesses to host
                  dedicated plastic film drop-off bins so Westerville neighbors can recycle soft
                  plastics with ease.
                </p>

                <div className="bg-blue-50 border border-lions-blue/20 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Drop-off Locations</h3>
                  {plasticLocations.length === 0 ? (
                    <p className="text-sm text-gray-600">
                      Locations coming soon &mdash; check back shortly or{" "}
                      <Link
                        href="/connect"
                        className="text-lions-blue font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                      >
                        contact us
                      </Link>{" "}
                      for details.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {plasticLocations.map((loc) => (
                        <LocationEntry key={loc.id} location={loc} />
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
                    What we accept
                  </h3>
                  <ul className="space-y-2">
                    {[
                      "Grocery and retail plastic bags",
                      "Bread bags",
                      "Zip-lock and resealable bags (clean)",
                      "Bubble wrap",
                      "Plastic film and stretch wrap",
                      "Produce bags",
                      "Any soft plastic you can stretch",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                        <svg
                          className="w-4 h-4 text-lions-blue flex-shrink-0 mt-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
                    What we cannot accept
                  </h3>
                  <ul className="space-y-2">
                    {[
                      "Rigid plastic containers or bottles",
                      "Plastic straws and utensils",
                      "Styrofoam",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                        <svg
                          className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

              </div>
            </article>
          </div>

          {/* CTA strip */}
          <div className="mt-16 text-center">
            <p className="text-lg text-gray-700 mb-6">Have questions about our programs?</p>
            <Link
              href="/connect"
              className="inline-block bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
            >
              Get In Touch
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
