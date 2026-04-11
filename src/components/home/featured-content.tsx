import Link from "next/link";
import Image from "next/image";
import type { HomepageAnnouncement } from "@/lib/db/schema";

type NextEvent = {
  id: string;
  title: string;
  startDate: Date;
  location: string | null;
  description: string | null;
  image: string | null;
};

type Props = {
  nextEvents: NextEvent[];
  activeAnnouncements: HomepageAnnouncement[];
};

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

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
        {formatEventDate(event.startDate)}
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
  );
}

function AnnouncementList({
  announcements,
}: {
  announcements: HomepageAnnouncement[];
}) {
  return (
    <div className="rounded-2xl bg-white shadow-lg overflow-hidden h-full">
      <ul>
        {announcements.map((item, index) => {
          const body =
            item.body && item.body.length > 200
              ? item.body.slice(0, 200) + "…"
              : item.body;
          const label = item.linkLabel ?? "Learn more";

          return (
            <li key={item.id}>
              {index > 0 && <hr className="border-gray-100 mx-8" />}
              <div className="px-8 py-5">
                <p className="font-semibold text-gray-900 text-sm leading-snug">
                  {item.title}
                </p>
                {body && (
                  <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                    {body}
                  </p>
                )}
                {item.linkUrl && (
                  <a
                    href={item.linkUrl}
                    className="mt-2 inline-flex items-center text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition-colors focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-1 rounded"
                    target={
                      item.linkUrl.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                      item.linkUrl.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                  >
                    {label} &rarr;
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type FeaturedContentProps = Props & { embedded?: boolean };

export default function FeaturedContent({ nextEvents, activeAnnouncements, embedded = false }: FeaturedContentProps) {
  if (nextEvents.length === 0 && activeAnnouncements.length === 0) {
    return null;
  }

  const hasEvents = nextEvents.length > 0;
  const hasAnnouncements = activeAnnouncements.length > 0;

  // Events-only grid class when no announcements
  const eventsOnlyGrid =
    nextEvents.length === 1 ? "" :
    nextEvents.length === 2 ? "md:grid-cols-2" :
    "md:grid-cols-3";

  const grid = (
    <div className={`grid gap-6 max-w-6xl mx-auto ${hasEvents && hasAnnouncements ? "md:grid-cols-3" : ""}`}>
      {hasEvents && (
        <div className={hasAnnouncements ? "md:col-span-2" : "w-full"}>
          {/* Badge above cards */}
          <div className="mb-3">
            <span className="inline-flex items-center rounded-full bg-lions-gold px-3 py-1 text-xs font-bold text-lions-blue-dark uppercase tracking-wide">
              Upcoming Events
            </span>
          </div>

          {/* Cards */}
          {nextEvents.length === 1 ? (
            <div className={hasAnnouncements ? "" : "max-w-2xl"}>
              <NextEventCard event={nextEvents[0]} />
            </div>
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
      )}
      {hasAnnouncements && (
        <div className={hasEvents ? "md:col-span-1" : "w-full"}>
          {/* Badge above card — matches Upcoming Events badge */}
          <div className="mb-3">
            <span className="inline-flex items-center rounded-full bg-lions-gold px-3 py-1 text-xs font-bold text-lions-blue-dark uppercase tracking-wide">
              Announcements
            </span>
          </div>
          <AnnouncementList announcements={activeAnnouncements} />
        </div>
      )}
    </div>
  );

  if (embedded) return grid;

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
