import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";
import { formatRecurrence } from "@/lib/events";
import MarkdownContent from "@/components/markdown-content";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.isPublic, true)))
    .then((r) => r[0]);

  if (!event) return { title: "Event Not Found" };

  return {
    title: event.title,
    description: event.description ?? `Join us for ${event.title} hosted by the Westerville Lions Club.`,
    alternates: { canonical: `https://westervillelions.org/events/${id}` },
    openGraph: {
      title: `${event.title} | Westerville Lions Club`,
      description: event.description ?? `Join us for ${event.title} hosted by the Westerville Lions Club.`,
      url: `https://westervillelions.org/events/${id}`,
      ...(event.image && {
        images: [{ url: event.image, width: 1200, height: 675, alt: event.title }],
      }),
    },
  };
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const event = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.isPublic, true)))
    .then((r) => r[0]);

  if (!event) notFound();

  const recurrenceLabel = formatRecurrence(event);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <Link href="/events" className="inline-flex items-center text-white/80 hover:text-white text-sm font-medium mb-6 transition">
            &larr; All Events
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">{event.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 text-blue-100 text-lg">
            <span>
              {recurrenceLabel ?? (
                <>
                  {format(new Date(event.startDate), "MMMM d, yyyy")} at{" "}
                  {format(new Date(event.startDate), "h:mm a")}
                  {event.endDate && (
                    <> &ndash; {format(new Date(event.endDate), "h:mm a")}</>
                  )}
                </>
              )}
            </span>
            {event.location && (
              <>
                <span className="text-white/40">·</span>
                <span>{event.location}</span>
              </>
            )}
            {event.isRecurring && (
              <span className="inline-block rounded-full bg-white/20 px-3 py-0.5 text-sm font-medium">
                Recurring
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {event.image && (
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-lg mb-10">
            <Image
              src={event.image}
              alt={event.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 896px"
              unoptimized={event.image.startsWith("http")}
              priority
            />
          </div>
        )}

        {event.description && (
          <div className="prose prose-lg max-w-none text-gray-700 mb-10">
            <MarkdownContent>{event.description}</MarkdownContent>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <Link
            href="/events"
            className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition"
          >
            &larr; Back to Events
          </Link>
          <Link
            href="/join"
            className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
          >
            Join the Lions Club
          </Link>
        </div>
      </div>
    </div>
  );
}
