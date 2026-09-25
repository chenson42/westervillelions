import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { events, eventRsvps, eventOccurrenceOverrides } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { format } from "date-fns";
import { formatRecurrence, generateOccurrences, parseWallClock, dateKey, easternOffsetFor, formatEventWhen, getNextOccurrence, buildGoogleCalendarUrl, buildOutlookCalendarUrl, nowEastern, type IcsEventInput } from "@/lib/events";
import { AddToCalendarDropdown } from "@/components/events/add-to-calendar-dropdown";
import MarkdownContent from "@/components/markdown-content";
import { EventPersonalization } from "@/components/events/event-personalization";
import { getPublicAttachedFiles } from "@/lib/club-files-queries";
import type { OccurrenceRow } from "@/types/events";

export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .then((r) => r[0]);

  if (!event) return { title: "Event Not Found" };

  const description =
    event.description ?? `Join us for ${event.title} hosted by the Westerville Lions Club.`;
  // Link previews (Open Graph unfurls) need an image on every event page —
  // an event without its own image falls back to the site's brand image so
  // a shared link never unfurls as bare text. The event image is also
  // mirrored into the Twitter card, which otherwise inherits the layout's
  // generic site image instead of the event's.
  //
  // Guard against base64 data: URIs (legacy uploads stored the image inline
  // rather than as a URL) — a multi-hundred-KB data URI in og:image/JSON-LD
  // breaks link unfurling on every platform that fetches it. A later batch
  // moves event images out of base64 storage entirely; this guard stays
  // regardless as a safety net for any image column value that isn't a URL.
  const previewImage =
    event.image && !event.image.startsWith("data:") ? event.image : "/images/og-default.jpg";

  return {
    title: event.title,
    description,
    alternates: { canonical: `https://westervillelions.org/events/${id}` },
    openGraph: {
      title: `${event.title} | Westerville Lions Club`,
      description,
      url: `https://westervillelions.org/events/${id}`,
      images: [{ url: previewImage, width: 1200, height: 675, alt: event.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${event.title} | Westerville Lions Club`,
      description,
      images: [previewImage],
    },
  };
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;

  const event = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .then((r) => r[0]);

  if (!event) notFound();

  const recurrenceLabel = formatRecurrence(event);

  // Attached Club Files (docs/work-log/2026-09-04-club-documents.md, Phase
  // 3 Component Plan). This single page serves both the public
  // /events/[id] route and /members/events/[id] (which redirects here).
  // The server render always uses the public-visibility baseline — who's
  // viewing is a per-request, session-dependent fact, and reading it here
  // via auth() would force this page dynamic (Batch 2,
  // docs/work-log/2026-09-04-site-review-fixes.md). A signed-in member with
  // a linked memberId sees the full (members-only-inclusive) list instead,
  // fetched client-side by <EventPersonalization> from
  // /api/events/[id]/viewer-context.
  const attachedFiles = await getPublicAttachedFiles(event.id);

  // Per-occurrence signup data (only when signups are enabled). Attendee
  // *counts* are public aggregate data — the same number regardless of who's
  // asking — so they're safe to compute here at build/revalidate time.
  // Signee *names*, however, are member data: this page is public and has no
  // auth() check, so nothing derived from a real name may enter the payload
  // handed to <EventPersonalization> (a Client Component — every prop
  // crossing that boundary is serialized into the page's RSC payload and
  // ships to the browser regardless of session). `signees` therefore always
  // starts as an empty baseline here, exactly like `isSignedUp` above, and a
  // signed-in viewer's real roster is fetched client-side from
  // /api/events/[id]/viewer-context, which does its own auth() check.
  // See docs/work-log/2026-09-25-recurring-occurrence-visibility.md (Phase 6
  // rework) — this query used to also select and join member names to build
  // that baseline; it no longer needs to.
  let occurrenceRows: OccurrenceRow[] = [];
  const signupsByDate = new Map<string, number>();

  if (event.requiresRsvp) {
    const [allRsvps, overrides] = await Promise.all([
      db
        .select({
          occurrenceDate: eventRsvps.occurrenceDate,
          guestCount: eventRsvps.guestCount,
        })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, id), ne(eventRsvps.status, "declined"))),
      db
        .select({
          occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
          cancellationReason: eventOccurrenceOverrides.cancellationReason,
        })
        .from(eventOccurrenceOverrides)
        .where(eq(eventOccurrenceOverrides.eventId, id)),
    ]);

    // Build cancellation map: YYYY-MM-DD → { reason }
    const cancelledDates = new Map(
      overrides.map((o) => [o.occurrenceDate, { reason: o.cancellationReason }])
    );

    for (const r of allRsvps) {
      // occurrenceDate is now a wall-clock string from DB (mode:"string"). Use it directly as key.
      const key = r.occurrenceDate ?? "null";
      // Count the attendee + their guests
      const attendeeTotal = 1 + (r.guestCount ?? 0);
      signupsByDate.set(key, (signupsByDate.get(key) ?? 0) + attendeeTotal);
    }

    if (event.isRecurring) {
      // nowEastern(), not new Date(): see src/lib/events.ts nowEastern() doc comment.
      const now = nowEastern();
      // Generate from the series start (like the admin page and signup API do), not from
      // `now` — a member looking up who signed up for a market that already happened needs
      // the past occurrence and its roster to still be here. See
      // docs/work-log/2026-09-25-recurring-occurrence-visibility.md.
      const occurrenceDates = generateOccurrences(event, parseWallClock(event.startDate), 520);

      // Build IcsEventInput for per-occurrence URL generation
      const siteUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";
      const icsInputForOccurrences: IcsEventInput = {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        isAllDay: event.isAllDay,
        startDate: event.startDate,
        endDate: event.endDate,
        isPublic: event.isPublic,
        url: `${siteUrl}/events/${event.id}`,
      };

      occurrenceRows = occurrenceDates.map((d) => {
        // Key must match what was stored in eventRsvps.occurrenceDate (wall-clock string).
        // format(d, "yyyy-MM-dd HH:mm:ss") produces the same format Postgres returns.
        const key = format(d, "yyyy-MM-dd HH:mm:ss");
        // Use dateKey() (local components) for cancellation lookup. See DECISION-005.
        const occKey = dateKey(d); // YYYY-MM-DD — matches date column
        const count = signupsByDate.get(key) ?? 0;
        const cancelled = cancelledDates.get(occKey);
        const isAllDay = event.isAllDay;
        return {
          date: d.toISOString(), // ISO string passed to client for RSVP round-trip
          dateKey: occKey,       // local YYYY-MM-DD for ICS occurrence param
          rsvpKey: key,          // wall-clock key for viewer-context isSignedUp matching
          displayDate: isAllDay ? format(d, "EEE, MMM d") : format(d, "EEE, MMM d 'at' h:mm a"),
          signedUpCount: count,
          // Signed-out baseline — <EventPersonalization> patches this in
          // client-side per viewer. See comment above occurrenceRows decl.
          isSignedUp: false,
          isFull: event.maxAttendees != null && count >= event.maxAttendees,
          isPast: d < now,
          // Signed-out baseline — real names come only from
          // /api/events/[id]/viewer-context, gated on a signed-in session.
          signees: [],
          isCancelled: cancelled !== undefined,
          cancellationReason: cancelled?.reason ?? null,
          // Pre-built provider URLs for AddToCalendarDropdown
          googleUrl: buildGoogleCalendarUrl(icsInputForOccurrences, d),
          outlookUrl: buildOutlookCalendarUrl(icsInputForOccurrences, d),
        };
      });
    }
  }

  // ── Add to Calendar URL builders ──────────────────────────────────────────
  // See: docs/work-log/2026-05-20-add-to-calendar-dropdown.md (Phase 3, §4)
  const siteUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";
  const icsInput: IcsEventInput = {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    isAllDay: event.isAllDay,
    startDate: event.startDate,
    endDate: event.endDate,
    isPublic: event.isPublic,
    url: `${siteUrl}/events/${event.id}`,
  };

  let calendarGoogleUrl: string | null = null;
  let calendarOutlookUrl: string | null = null;

  if (event.isRecurring) {
    // Series-level button: target the next upcoming occurrence.
    // Fetch cancellation overrides once — needed to determine which occurrences are active.
    const overridesForSeries = await db
      .select({ occurrenceDate: eventOccurrenceOverrides.occurrenceDate })
      .from(eventOccurrenceOverrides)
      .where(eq(eventOccurrenceOverrides.eventId, id));

    const cancelledSetForSeries = new Set(overridesForSeries.map((o) => o.occurrenceDate));
    // nowEastern(), not new Date(): see src/lib/events.ts nowEastern() doc comment.
    const nextOccurrenceDate = getNextOccurrence(event, nowEastern(), cancelledSetForSeries);

    if (nextOccurrenceDate !== null) {
      calendarGoogleUrl = buildGoogleCalendarUrl(icsInput, nextOccurrenceDate);
      calendarOutlookUrl = buildOutlookCalendarUrl(icsInput, nextOccurrenceDate);
    }
    // else: both remain null → dropdown items will be disabled (D12)
  } else {
    // Non-recurring: build directly from startDate
    const startOccurrence = parseWallClock(event.startDate);
    calendarGoogleUrl = buildGoogleCalendarUrl(icsInput, startOccurrence);
    calendarOutlookUrl = buildOutlookCalendarUrl(icsInput, startOccurrence);
  }

  // JSON-LD startDate: date-only for all-day; DST-aware Eastern offset for timed events.
  // See resolved Open Question 1 in Phase 1 work-log and DECISION-006.
  const startDateParsed = parseWallClock(event.startDate);
  const jsonLdStartDate = event.isAllDay
    ? event.startDate.slice(0, 10)
    : `${event.startDate.slice(0, 10)}T${event.startDate.slice(11, 16)}:00${easternOffsetFor(startDateParsed)}`;
  const jsonLdEndDate = event.endDate
    ? (event.isAllDay
        ? event.endDate.slice(0, 10)
        : `${event.endDate.slice(0, 10)}T${event.endDate.slice(11, 16)}:00${easternOffsetFor(parseWallClock(event.endDate))}`)
    : undefined;

  // Same data: URI guard as generateMetadata()'s previewImage above — never
  // emit a raw base64 data: URI into the JSON-LD image. schema.org wants an
  // absolute URL, so resolve a relative fallback path against the origin.
  const jsonLdImage = event.image && !event.image.startsWith("data:") ? event.image : "/images/og-default.jpg";
  const jsonLdImageAbsolute = jsonLdImage.startsWith("http")
    ? jsonLdImage
    : `https://westervillelions.org${jsonLdImage}`;

  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.description ?? undefined,
    url: `https://westervillelions.org/events/${event.id}`,
    image: jsonLdImageAbsolute,
    startDate: jsonLdStartDate,
    ...(jsonLdEndDate && { endDate: jsonLdEndDate }),
    ...(event.location && {
      location: {
        "@type": "Place",
        name: event.location,
      },
    }),
    organizer: {
      "@type": "Organization",
      name: "Westerville Lions Club",
      url: "https://westervillelions.org",
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd) }} />
      {/* Hero */}
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <Link href="/events" className="inline-flex items-center text-white/80 hover:text-white text-sm font-medium mb-6 transition">
            &larr; All Events
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">{event.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 text-blue-100 text-lg">
            <span>
              {recurrenceLabel ?? formatEventWhen(event)}
              {!recurrenceLabel && !event.isAllDay && event.endDate && (
                <> &ndash; {format(parseWallClock(event.endDate), "h:mm a")}</>
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

        <EventPersonalization
          eventId={event.id}
          requiresRsvp={event.requiresRsvp}
          isRecurring={event.isRecurring}
          occurrenceRows={occurrenceRows}
          maxAttendees={event.maxAttendees ?? null}
          allowGuestCount={event.allowGuestCount}
          extraQuestion={event.extraQuestion}
          extraQuestionType={event.extraQuestionType}
          extraQuestionOptions={event.extraQuestionOptions ?? []}
          extraQuestionRequired={event.extraQuestionRequired}
          singleEventSignedUpCount={signupsByDate.get("null") ?? 0}
          // Signed-out baseline — see the comment above occurrenceRows'
          // `signees: []`. Real names for the "null" (non-recurring) key
          // come from /api/events/[id]/viewer-context once signed in.
          singleEventSignees={[]}
          attachedFilesBaseline={attachedFiles}
        />

        <div className="flex flex-wrap gap-4">
          {/* C8: series button for recurring events; single button for non-recurring */}
          {event.isRecurring ? (
            <AddToCalendarDropdown
              eventId={event.id}
              label="Add full series to Calendar"
              googleUrl={calendarGoogleUrl}
              outlookUrl={calendarOutlookUrl}
              isSeriesLevel
            />
          ) : (
            <AddToCalendarDropdown
              eventId={event.id}
              occurrence={dateKey(parseWallClock(event.startDate))}
              googleUrl={calendarGoogleUrl}
              outlookUrl={calendarOutlookUrl}
            />
          )}
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
