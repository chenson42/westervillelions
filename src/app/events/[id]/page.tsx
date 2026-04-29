import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { events, eventRsvps, users } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { format } from "date-fns";
import { formatRecurrence, generateOccurrences } from "@/lib/events";
import MarkdownContent from "@/components/markdown-content";
import { auth } from "@/lib/auth";
import { PublicRsvpForm } from "@/components/public/public-rsvp-form";
import { OccurrenceSignupList } from "@/components/events/occurrence-signup-list";
import { SingleEventSignup } from "@/components/events/single-event-signup";
import type { OccurrenceRow } from "@/types/events";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
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

  const [event, session] = await Promise.all([
    db
      .select()
      .from(events)
      .where(eq(events.id, id))
      .then((r) => r[0]),
    auth(),
  ]);

  if (!event) notFound();

  const isLoggedIn = !!session?.user;
  const recurrenceLabel = formatRecurrence(event);

  // Per-occurrence signup data (only when signups are enabled)
  let occurrenceRows: OccurrenceRow[] = [];
  const signupsByDate = new Map<string, number>();
  const userSignupDates = new Set<string>();

  const signeesByDate = new Map<string, string[]>();

  if (event.requiresRsvp) {
    const allRsvps = await db
      .select({
        occurrenceDate: eventRsvps.occurrenceDate,
        userId: eventRsvps.userId,
        status: eventRsvps.status,
        userName: users.name,
      })
      .from(eventRsvps)
      .leftJoin(users, eq(eventRsvps.userId, users.id))
      .where(and(eq(eventRsvps.eventId, id), ne(eventRsvps.status, "declined")));

    for (const r of allRsvps) {
      const key = r.occurrenceDate?.toISOString() ?? "null";
      signupsByDate.set(key, (signupsByDate.get(key) ?? 0) + 1);
      if (r.userId === session?.user?.id) userSignupDates.add(key);
      if (r.userName) {
        const names = signeesByDate.get(key) ?? [];
        names.push(r.userName);
        signeesByDate.set(key, names);
      }
    }

    if (event.isRecurring) {
      const now = new Date();
      const occurrenceDates = generateOccurrences(event, now);

      occurrenceRows = occurrenceDates.map((d) => {
        const key = d.toISOString();
        const count = signupsByDate.get(key) ?? 0;
        return {
          date: key,
          displayDate: format(d, "EEE, MMM d 'at' h:mm a"),
          signedUpCount: count,
          isSignedUp: userSignupDates.has(key),
          isFull: event.maxAttendees != null && count >= event.maxAttendees,
          isPast: d < now,
          signees: signeesByDate.get(key) ?? [],
        };
      });
    }
  }

  // Fetch existing RSVP for the PublicRsvpForm (non-recurring only)
  const userRsvp =
    !event.isRecurring && session?.user?.id
      ? await db.query.eventRsvps.findFirst({
          where: and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, session.user.id)),
        })
      : undefined;

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
          <div className="relative w-full aspect-[7/2] rounded-2xl overflow-hidden shadow-lg mb-10">
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

        {event.requiresRsvp && (
          <div className="mt-8 mb-10">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {event.isRecurring ? "Sign Up for a Date" : "Sign Up"}
            </h2>
            {event.isRecurring ? (
              <OccurrenceSignupList
                eventId={event.id}
                occurrences={occurrenceRows}
                maxAttendees={event.maxAttendees ?? null}
                isLoggedIn={isLoggedIn}
                currentUserName={session?.user?.name ?? null}
              />
            ) : (
              <>
                <SingleEventSignup
                  eventId={event.id}
                  signedUpCount={signupsByDate.get("null") ?? 0}
                  maxAttendees={event.maxAttendees ?? null}
                  isSignedUp={userSignupDates.has("null")}
                  isLoggedIn={isLoggedIn}
                  currentUserName={session?.user?.name ?? null}
                  initialSignees={signeesByDate.get("null") ?? []}
                />
                <div className="mt-6">
                  <PublicRsvpForm
                    eventId={event.id}
                    allowGuestCount={event.allowGuestCount}
                    isLoggedIn={isLoggedIn}
                    initialStatus={userRsvp?.status ?? null}
                    initialGuestCount={userRsvp?.guestCount ?? 0}
                  />
                </div>
              </>
            )}
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
