import Link from "next/link";
import { causes } from "@/lib/causes";
import { CauseIcon } from "@/components/cause-icon";

// Compact navigation band for the eight Lions Clubs International global
// causes. Order and titles come from the shared src/lib/causes.ts module
// (also used by /mission's full "How We Serve" deep dive) — this component
// only owns presentation: icon + title, no description text, so the two
// pages don't repeat the same copy at different lengths.
//
// Icons come from the shared <CauseIcon> component (src/components/
// cause-icon.tsx) so the homepage and /mission render the identical
// hand-drawn stroke icon per cause.

export function ServiceAreas() {
  return (
    <section
      aria-labelledby="service-areas-heading"
      className="py-20 bg-gradient-to-b from-gray-50 to-white"
    >
      <div className="container mx-auto px-4">
        <h2
          id="service-areas-heading"
          className="text-4xl md:text-5xl font-bold text-center mb-4 text-gray-900"
        >
          Our Service Areas
        </h2>
        <div
          className="mx-auto mb-5 h-1 w-16 rounded-full bg-lions-gold"
          aria-hidden="true"
        />
        <p className="text-center text-lg sm:text-xl text-gray-600 mb-12 max-w-3xl mx-auto">
          The eight global causes we serve — here in Westerville and around
          the world.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {causes.map((cause) => (
            <Link
              key={cause.slug}
              href={`/mission#${cause.slug}`}
              className="group flex flex-col items-center gap-3 bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-5 sm:p-6 text-center focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lions-blue/10 text-lions-blue transition-colors group-hover:bg-lions-blue group-hover:text-white group-focus:bg-lions-blue group-focus:text-white">
                <CauseIcon slug={cause.slug} className="h-6 w-6" />
              </span>
              <h3 className="text-sm sm:text-base font-bold text-gray-900">
                {cause.title}
              </h3>
            </Link>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/mission"
            className="inline-flex items-center text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition-colors focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 rounded"
          >
            Learn more about how we serve
            <svg
              className="ml-1 w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
