import Link from "next/link";
import type { ReactNode } from "react";

// The eight Lions Clubs International global causes, mirroring the
// authoritative list and framing on /mission (src/app/mission/page.tsx).
// Order is deliberate: community-forward areas lead; Vision is included
// but not dominant, per the Brand Guidelines in CLAUDE.md.
//
// Icons are hand-drawn 24×24-grid stroke paths (strokeWidth 1.5, round
// caps/joins) matching the heroicon-style SVGs already used across the
// site — no icon library dependency.
type Cause = {
  slug: string;
  title: string;
  description: string;
  icon: ReactNode;
};

const causes: Cause[] = [
  {
    slug: "community-service",
    title: "Community Service",
    description:
      "Rolling up our sleeves alongside neighbors at drives and civic events.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 8.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18 8.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 19.5a4.5 4.5 0 0 1 9 0"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.02 15.34a4.5 4.5 0 0 1 7.23 4.16"
        />
      </>
    ),
  },
  {
    slug: "youth-programs",
    title: "Youth Programs",
    description:
      "Scholarships, leadership, and opportunities for the next generation.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 4.5 2.25 9 12 13.5 21.75 9 12 4.5Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.75 11.4v4.35c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V11.4"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v4.5" />
      </>
    ),
  },
  {
    slug: "hunger-relief",
    title: "Hunger Relief",
    description:
      "Working with local food banks so no family in Westerville goes without.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 12.75h15a7.5 7.5 0 0 1-7.5 7.5 7.5 7.5 0 0 1-7.5-7.5Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 9.75c0-.9.9-1.35.9-2.25 0-.75-.45-1.05-.45-1.75"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 9.75c0-.9.9-1.35.9-2.25 0-.75-.45-1.05-.45-1.75"
        />
      </>
    ),
  },
  {
    slug: "environment",
    title: "Environment",
    description:
      "Clean-ups and conservation that protect our natural spaces.",
    icon: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 12.75C12 8.6 8.6 6 4.5 6c0 4.1 3.4 6.75 7.5 6.75Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9.75c0-3.45 2.8-6 7.5-6 0 4.5-3.4 6-7.5 6Z"
        />
      </>
    ),
  },
  {
    slug: "vision",
    title: "Vision",
    description:
      "Screenings and recycled eyeglasses in the fight against preventable blindness.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        />
      </>
    ),
  },
  {
    slug: "diabetes-awareness",
    title: "Diabetes Awareness",
    description:
      "Prevention, education, and support for neighbors living with diabetes.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3.75s6 6.25 6 10.5a6 6 0 1 1-12 0c0-4.25 6-10.5 6-10.5Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 14.25a2.25 2.25 0 0 0 2.25 2.25"
        />
      </>
    ),
  },
  {
    slug: "childhood-cancer",
    title: "Childhood Cancer",
    description:
      "Standing with children and families facing cancer, together with LCIF.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3.75c-1.8 0-3 1.35-3 3 0 2.4 2.1 4.05 3 4.8.9-.75 3-2.4 3-4.8 0-1.65-1.2-3-3-3Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.9 10.4 5.5 9.85" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m14.1 10.4-5.5 9.85" />
      </>
    ),
  },
  {
    slug: "humanitarian-aid",
    title: "Humanitarian Aid",
    description:
      "Mobilizing relief when disaster strikes — at home and around the world.",
    icon: (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.3 12h17.4" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3c2.5 2.4 3.75 5.4 3.75 9S14.5 18.6 12 21c-2.5-2.4-3.75-5.4-3.75-9S9.5 5.4 12 3Z"
        />
      </>
    ),
  },
];

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
          Our service spans Lions Clubs International&apos;s eight global causes
          — and the everyday needs of our own backyard.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {causes.map((cause) => (
            <Link
              key={cause.slug}
              href={`/mission#${cause.slug}`}
              className="group block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 sm:p-6 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lions-blue/10 text-lions-blue transition-colors group-hover:bg-lions-blue group-hover:text-white group-focus:bg-lions-blue group-focus:text-white">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  {cause.icon}
                </svg>
              </span>
              <h3 className="mt-4 text-base sm:text-lg font-bold text-gray-900">
                {cause.title}
              </h3>
              <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
                {cause.description}
              </p>
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
