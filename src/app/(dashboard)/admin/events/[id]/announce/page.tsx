import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAnnouncementRecipients,
  getFutureOccurrenceOptions,
  getEventAnnouncementHistory,
} from "@/lib/event-announcements-queries";
import { EventAnnounceSender } from "@/components/admin/event-announce-sender";
import { EventAnnouncementHistoryTable } from "@/components/admin/event-announcement-history-table";

export const dynamic = "force-dynamic";

export default async function AnnounceEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Independent, narrower gate than EVENTS_EDIT (Phase 1 User Decision 1) —
  // an EVENTS_EDIT holder without EVENTS_ANNOUNCE must not reach this page.
  // Redirects to /admin/events (not back to [id]) since an EVENTS_ANNOUNCE-
  // lacking visitor isn't guaranteed to hold EVENTS_EDIT either. See
  // docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3
  // "Component / Page Plan".
  const canAnnounce = await hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE);
  if (!canAnnounce) redirect("/admin/events");

  const { id } = await params;

  const event = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!event) notFound();

  // Same query helpers the GET route calls — first paint mirrors what
  // "Refresh" would fetch.
  const [occurrenceOptions, allRecipients, history] = await Promise.all([
    getFutureOccurrenceOptions(id, event),
    getAnnouncementRecipients(),
    getEventAnnouncementHistory(id),
  ]);

  const withEmail = allRecipients
    .filter((m) => m.email && m.email.trim())
    .map((m) => ({ memberId: m.memberId, firstName: m.firstName, lastName: m.lastName }));
  const withoutEmail = allRecipients
    .filter((m) => !m.email || !m.email.trim())
    .map((m) => ({ memberId: m.memberId, firstName: m.firstName, lastName: m.lastName }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Link
          href="/admin/events"
          className="hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          Events
        </Link>
        <span>/</span>
        <Link
          href={`/admin/events/${id}`}
          className="hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          {event.title}
        </Link>
        <span>/</span>
        <span className="text-gray-900">Announce</span>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Send Announcement</h1>
        <p className="mt-1 text-gray-600">
          Emails every active member the details for this event, with a calendar invite attached.
        </p>
      </div>

      <EventAnnounceSender
        eventId={id}
        event={{
          title: event.title,
          isRecurring: event.isRecurring,
          isAllDay: event.isAllDay,
          location: event.location ?? null,
        }}
        initialOccurrenceOptions={occurrenceOptions}
        initialHasFutureOccurrence={occurrenceOptions.length > 0}
        initialRecipients={{ withEmail, withoutEmail }}
      />

      <EventAnnouncementHistoryTable history={history} />
    </div>
  );
}
