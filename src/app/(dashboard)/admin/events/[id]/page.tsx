import EventForm from "@/components/admin/event-form";
import { db } from "@/lib/db";
import { events, eventRsvps, users } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { generateOccurrences } from "@/lib/events";
import { format } from "date-fns";
import { AdminOccurrenceRsvpSection } from "@/components/admin/occurrence-rsvp-section";
import { AdminEventRsvpTable } from "@/components/admin/admin-event-rsvp-table";

type RsvpRow = {
  id: string;
  userId: string | null;
  status: string;
  guestCount: number | null;
  createdAt: Date;
  rsvpName: string | null;
  rsvpEmail: string | null;
  userName: string | null;
  userEmail: string | null;
  occurrenceDate: Date | null;
};

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [event, rsvpRows, memberList] = await Promise.all([
    db.query.events.findFirst({
      where: eq(events.id, id),
    }),
    db
      .select({
        id: eventRsvps.id,
        userId: eventRsvps.userId,
        status: eventRsvps.status,
        guestCount: eventRsvps.guestCount,
        createdAt: eventRsvps.createdAt,
        rsvpName: eventRsvps.rsvpName,
        rsvpEmail: eventRsvps.rsvpEmail,
        occurrenceDate: eventRsvps.occurrenceDate,
        userName: users.name,
        userEmail: users.email,
      })
      .from(eventRsvps)
      .leftJoin(users, eq(eventRsvps.userId, users.id))
      .where(eq(eventRsvps.eventId, id))
      .orderBy(eventRsvps.createdAt),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(isNotNull(users.name))
      .orderBy(users.name),
  ]);

  if (!event) notFound();

  // Format dates for datetime-local input (YYYY-MM-DDTHH:mm)
  const toInputValue = (date: Date | null) =>
    date ? new Date(date).toISOString().slice(0, 16) : "";

  const showRsvpSection = event.requiresRsvp || rsvpRows.length > 0;

  // ── Recurring: group rsvpRows by occurrence date ──────────────────────────
  let occurrenceGroups: Array<{
    date: Date;
    displayDate: string;
    isPast: boolean;
    rows: RsvpRow[];
  }> = [];

  if (event.isRecurring) {
    // Get all occurrences from series start so admins can see historical data
    const allOccurrenceDates = generateOccurrences(event, event.startDate, 520);
    const now = new Date();

    // Build a lookup: occurrenceDate ISO key → RsvpRow[]
    const rsvpByDate = new Map<string, RsvpRow[]>();
    for (const row of rsvpRows) {
      const key = row.occurrenceDate?.toISOString() ?? "null";
      const existing = rsvpByDate.get(key) ?? [];
      existing.push(row);
      rsvpByDate.set(key, existing);
    }

    occurrenceGroups = allOccurrenceDates.map((d) => ({
      date: d,
      displayDate: format(d, "EEE, MMM d, yyyy 'at' h:mm a"),
      isPast: d < now,
      rows: rsvpByDate.get(d.toISOString()) ?? [],
    }));
  }

  // ── Non-recurring: flat summary numbers ───────────────────────────────────
  const attending = rsvpRows.filter((r) => r.status === "attending");
  const maybe = rsvpRows.filter((r) => r.status === "maybe");
  const declined = rsvpRows.filter((r) => r.status === "declined");
  const totalGuests = attending.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);

  // memberList name is non-null due to isNotNull filter but TypeScript doesn't know that
  const safeMemberList = memberList.map((m) => ({ id: m.id, name: m.name! }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/events" className="hover:text-gray-900">
            Events
          </Link>
          <span>/</span>
          <span className="text-gray-900">{event.title}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Edit Event</h1>
      </div>

      <EventForm
        eventId={id}
        event={{
          title: event.title,
          description: event.description,
          startDate: toInputValue(event.startDate),
          endDate: toInputValue(event.endDate),
          location: event.location,
          image: event.image,
          isPublic: event.isPublic,
          isFeatured: event.isFeatured,
          requiresRsvp: event.requiresRsvp,
          allowGuestCount: event.allowGuestCount,
          maxAttendees: event.maxAttendees,
          isRecurring: event.isRecurring,
          recurrenceType: event.recurrenceType,
          recurrenceDays: event.recurrenceDays,
          recurrenceEndDate: event.recurrenceEndDate
            ? event.recurrenceEndDate.toISOString().slice(0, 10)
            : null,
        }}
      />

      {showRsvpSection && (
        <div id="attendance" className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {event.isRecurring ? "Signups by Occurrence" : "RSVP Details"}
          </h2>

          {event.isRecurring ? (
            // ── Recurring: grouped by occurrence ──────────────────────────
            <div className="mt-4 space-y-3">
              {occurrenceGroups.length === 0 ? (
                <p className="text-sm text-gray-500">No occurrences generated for this series.</p>
              ) : (
                <AdminOccurrenceRsvpSection
                  eventId={id}
                  members={safeMemberList}
                  occurrenceGroups={occurrenceGroups.map((g) => ({
                    date: g.date.toISOString(),
                    displayDate: g.displayDate,
                    isPast: g.isPast,
                    maxAttendees: event.maxAttendees ?? null,
                    rows: g.rows.map((r) => ({
                      id: r.id,
                      userId: r.userId,
                      status: r.status,
                      createdAt: r.createdAt.toISOString(),
                      name: r.userName || r.rsvpName || null,
                      email: r.userEmail || r.rsvpEmail || null,
                      isGuest: !!r.rsvpEmail,
                    })),
                  }))}
                />
              )}
            </div>
          ) : (
            // ── Non-recurring: client table with add/remove ────────────────
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-md bg-green-50 p-3 text-center">
                  <div className="text-2xl font-bold text-green-800">{attending.length}</div>
                  <div className="text-xs font-medium text-green-700">Attending</div>
                </div>
                <div className="rounded-md bg-yellow-50 p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-800">{maybe.length}</div>
                  <div className="text-xs font-medium text-yellow-700">Maybe</div>
                </div>
                <div className="rounded-md bg-red-50 p-3 text-center">
                  <div className="text-2xl font-bold text-red-800">{declined.length}</div>
                  <div className="text-xs font-medium text-red-700">Declined</div>
                </div>
                <div className="rounded-md bg-blue-50 p-3 text-center">
                  <div className="text-2xl font-bold text-blue-800">{totalGuests}</div>
                  <div className="text-xs font-medium text-blue-700">Total Guests</div>
                </div>
              </div>

              <div className="mt-6">
                <AdminEventRsvpTable
                  eventId={id}
                  members={safeMemberList}
                  rows={rsvpRows.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    status: r.status,
                    guestCount: r.guestCount,
                    createdAt: r.createdAt.toISOString(),
                    userName: r.userName,
                    userEmail: r.userEmail,
                    rsvpName: r.rsvpName,
                    rsvpEmail: r.rsvpEmail,
                  }))}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
