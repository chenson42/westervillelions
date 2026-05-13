import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { glassesDropoffLocations } from "@/lib/db/schema";
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

export default async function ProgramsPage() {
  const dropoffLocations = await db
    .select()
    .from(glassesDropoffLocations)
    .where(eq(glassesDropoffLocations.isActive, true))
    .orderBy(asc(glassesDropoffLocations.sortOrder), asc(glassesDropoffLocations.name));

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

                <div className="mt-auto bg-blue-50 border border-lions-blue/20 rounded-xl p-4">
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
                    <ul className="space-y-2">
                      {dropoffLocations.map((loc) => (
                        <li key={loc.id} className="text-sm">
                          <span className="font-medium text-gray-900">{loc.name}</span>
                          <span className="text-gray-500"> &mdash; {loc.address}</span>
                          {loc.phone && (
                            <>
                              {" "}
                              &middot;{" "}
                              <a
                                href={`tel:${loc.phone.replace(/[^0-9+]/g, "")}`}
                                className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                              >
                                {loc.phone}
                              </a>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
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
                  equipment and ends up in landfills. The club has partnered with{" "}
                  <strong className="text-gray-900">Pure Roots</strong>, a local boutique in
                  Westerville, to host a dedicated plastic film drop-off bin. Enter through the{" "}
                  <strong className="text-gray-900">back door</strong> when dropping off.
                </p>

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

                <div className="bg-blue-50 border border-lions-blue/20 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Drop-off Location</h3>
                  <p className="text-sm text-gray-600">
                    <a
                      href="https://www.purerootsboutique.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lions-blue font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      Pure Roots
                    </a>
                    {" "}boutique, Westerville, OH &mdash; enter through the{" "}
                    <strong className="text-gray-900">back door</strong>.
                  </p>
                  <div className="mt-3 rounded-lg overflow-hidden border border-lions-blue/10">
                    <iframe
                      title="Pure Roots drop-off location"
                      src="https://maps.google.com/maps?q=Pure+Roots+Westerville+OH&output=embed&z=15"
                      width="100%"
                      height="200"
                      style={{ border: 0 }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
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
