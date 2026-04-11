import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { events, eventRsvps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import { formatRecurrence } from "@/lib/events";
import MarkdownContent from "@/components/markdown-content";
import { EventRsvp } from "@/components/members/event-rsvp";

type Props = { params: Promise<{ id: string }> };

export default async function MemberEventDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;

  const event = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .then((r) => r[0]);

  if (!event) notFound();

  const userRsvp = session.user.id
    ? await db
        .select()
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, session.user.id!)))
        .then((r) => r[0])
    : null;

  const recurrenceLabel = formatRecurrence(event);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <Link href="/members/events" className="inline-flex items-center text-white/80 hover:text-white text-sm font-medium mb-6 transition">
            &larr; All Events
          </Link>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h1 className="text-3xl md:text-4xl font-bold leading-tight">{event.title}</h1>
            {!event.isPublic && (
              <span className="inline-block rounded-full bg-white/20 px-3 py-0.5 text-sm font-medium">
                Members Only
              </span>
            )}
            {event.isRecurring && (
              <span className="inline-block rounded-full bg-white/20 px-3 py-0.5 text-sm font-medium">
                Recurring
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-blue-100">
            <span>
              {recurrenceLabel ?? (
                <>
                  {format(new Date(event.startDate), "EEEE, MMMM d, yyyy")} at{" "}
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
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-4xl">
        {event.image && (
          <div className="relative w-full aspect-[7/2] rounded-2xl overflow-hidden shadow-lg mb-8">
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

        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-1">
            {event.description && (
              <div className="prose max-w-none text-gray-700 mb-6">
                <MarkdownContent>{event.description}</MarkdownContent>
              </div>
            )}
            {event.maxAttendees && (
              <p className="text-sm text-gray-500 mb-6">Capacity: {event.maxAttendees} attendees</p>
            )}
            <Link
              href="/members/events"
              className="text-lions-blue hover:underline text-sm"
            >
              &larr; Back to Events
            </Link>
          </div>

          <div className="shrink-0">
            <EventRsvp
              eventId={event.id}
              initialStatus={(userRsvp?.status ?? null) as "attending" | "maybe" | "declined" | null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
