import Link from "next/link";
import Image from "next/image";
import { formatWallClockDate } from "@/lib/events";

type NextEvent = {
  id: string;
  title: string;
  // The event's next upcoming occurrence (already computed by the caller via
  // getNextOccurrence) — NOT the series' original startDate. For recurring
  // events like "every Saturday", this is the next Saturday, not the first.
  nextOccurrence: Date;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  image: string | null;
};

type Props = {
  nextEvents: NextEvent[];
};

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .replace(/[*_~`]/g, "")                  // bold/italic/strikethrough/code
    .replace(/^#{1,6}\s+/gm, "")            // headings
    .trim();
}

function NextEventCard({ event }: { event: NextEvent }) {
  const plain = event.description ? stripMarkdown(event.description) : null;
  const description =
    plain && plain.length > 150 ? plain.slice(0, 150) + "…" : plain;

  return (
    <Link
      href={`/events/${event.id}`}
      aria-label={`View details for ${event.title}`}
      className="block h-full focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-2xl"
    >
    <article className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden h-full flex flex-col">
      {event.image && (
        <div className="relative w-full aspect-[7/2] shrink-0">
          <Image
            src={event.image}
            alt={event.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 400px"
            unoptimized={event.image.startsWith("http")}
          />
        </div>
      )}
      <div className="p-8 flex flex-col flex-1">
      <h3 className="text-xl font-bold text-lions-blue mb-2">{event.title}</h3>
      <p className="text-sm font-medium text-lions-blue mb-1">
        {formatWallClockDate(event.nextOccurrence, event.isAllDay)}
      </p>
      {event.location && (
        <p className="text-sm text-gray-500 mb-3 flex items-center gap-1">
          <svg
            className="w-4 h-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
            />
          </svg>
          {event.location}
        </p>
      )}
      {description && (
        <p className="text-gray-600 text-sm leading-relaxed flex-1">
          {description}
        </p>
      )}
      </div>
    </article>
    </Link>
  );
}

// Announcements are not listed here: they show only as buttons in the homepage hero.
export default function FeaturedContent({ nextEvents }: Props) {
  if (nextEvents.length === 0) {
    return null;
  }

  const eventsOnlyGrid =
    nextEvents.length === 1 ? "" :
    nextEvents.length === 2 ? "md:grid-cols-2" :
    "md:grid-cols-3";

  const grid = (
    <div className="max-w-6xl mx-auto">
      <div className={nextEvents.length === 1 ? "max-w-2xl mx-auto" : ""}>
          {/* Badge above cards */}
          <div className="mb-3">
            <span className="inline-flex items-center rounded-full bg-lions-gold px-3 py-1 text-xs font-bold text-lions-blue-dark uppercase tracking-wide">
              Upcoming Events
            </span>
          </div>

          {/* Cards */}
          {nextEvents.length === 1 ? (
            <NextEventCard event={nextEvents[0]} />
          ) : (
            <div className={`grid gap-4 ${eventsOnlyGrid}`}>
              {nextEvents.map((event) => (
                <NextEventCard key={event.id} event={event} />
              ))}
            </div>
          )}

          {/* See All Events below cards */}
          <div className="mt-4">
            <Link
              href="/events"
              aria-label="See all upcoming events"
              className="inline-flex items-center text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition-colors focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 rounded"
            >
              See All Events
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
    </div>
  );

  return (
    <section className="py-16 bg-lions-blue/5">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-10 text-center">
          What&rsquo;s Happening
        </h2>
        {grid}
      </div>
    </section>
  );
}
