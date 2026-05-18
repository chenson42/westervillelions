import EventForm from "@/components/admin/event-form";
import { db } from "@/lib/db";
import { events, eventRsvps, users, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { generateOccurrences, parseWallClock, dateKey } from "@/lib/events";
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
  occurrenceDate: string | null; // wall-clock string from DB (mode:"string")
  extraAnswer: string | null;
};

type OccurrenceGroupData = {
  date: Date;
  displayDate: string;
  isPast: boolean;
  isCancelled: boolean;
  cancellationReason: string | null;
  isOrphan: boolean; // true when date falls outside current recurrence window (DECISION-003)
  rows: RsvpRow[];
};

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [event, rsvpRows, memberList, overrides] = await Promise.all([
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
        extraAnswer: eventRsvps.extraAnswer,
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
    db
      .select({
        occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
        cancellationReason: eventOccurrenceOverrides.cancellationReason,
      })
      .from(eventOccurrenceOverrides)
      .where(eq(eventOccurrenceOverrides.eventId, id)),
  ]);

  if (!event) notFound();

  // Format wall-clock strings for datetime-local input (YYYY-MM-DDTHH:mm).
  // event dates are now "YYYY-MM-DD HH:MM:SS" strings (mode:"string"). No UTC conversion.
  const toInputValue = (s: string | null) =>
    s ? s.slice(0, 10) + "T" + s.slice(11, 16) : "";

  const showRsvpSection = event.requiresRsvp || rsvpRows.length > 0;

  // ── Recurring: group rsvpRows by occurrence date ──────────────────────────
  let occurrenceGroups: OccurrenceGroupData[] = [];

  if (event.isRecurring) {
    // Get all occurrences from series start so admins can see historical data.
    // event.startDate is now a wall-clock string; parse it to Date for the `from` arg.
    const allOccurrenceDates = generateOccurrences(event, parseWallClock(event.startDate), 520);
    const now = new Date();

    // Build cancellation map: YYYY-MM-DD → { reason }
    const cancelledMap = new Map(
      overrides.map((o) => [o.occurrenceDate, { reason: o.cancellationReason }])
    );

    // Build a lookup: occurrenceDate wall-clock string → RsvpRow[]
    // occurrenceDate is now a string from DB (mode:"string"). Use it directly.
    // See DECISION-007 for the key format decision.
    const rsvpByDate = new Map<string, RsvpRow[]>();
    for (const row of rsvpRows) {
      const key = row.occurrenceDate ?? "null";
      const existing = rsvpByDate.get(key) ?? [];
      existing.push(row);
      rsvpByDate.set(key, existing);
    }

    // Track which YYYY-MM-DD keys appear in the generated window
    const generatedDateKeys = new Set<string>();

    occurrenceGroups = allOccurrenceDates.map((d) => {
      // Use dateKey() (local components) for cancellation lookup. See DECISION-005.
      const dk = dateKey(d);
      generatedDateKeys.add(dk);
      const cancelled = cancelledMap.get(dk);
      // Lookup key must match rsvpByDate which uses wall-clock "YYYY-MM-DD HH:MM:SS" format.
      // See DECISION-007.
      const rsvpKey = format(d, "yyyy-MM-dd HH:mm:ss");
      return {
        date: d,
        displayDate: format(d, "EEE, MMM d, yyyy 'at' h:mm a"),
        isPast: d < now,
        isCancelled: cancelled !== undefined,
        cancellationReason: cancelled?.reason ?? null,
        isOrphan: false,
        rows: rsvpByDate.get(rsvpKey) ?? [],
      };
    });

    // DECISION-003: surface orphaned cancellation records — those that fall outside
    // the current generated window. Append as extra rows so admins can restore them.
    for (const [dateKey, { reason }] of cancelledMap) {
      if (generatedDateKeys.has(dateKey)) continue; // already in the list
      // Parse the YYYY-MM-DD string as a local-noon date to avoid UTC midnight weirdness
      const [year, month, day] = dateKey.split("-").map(Number);
      const orphanDate = new Date(year, month - 1, day, 12, 0, 0);
      occurrenceGroups.push({
        date: orphanDate,
        displayDate: `${format(orphanDate, "EEE, MMM d, yyyy")} — Cancelled (outside current recurrence rule)`,
        isPast: orphanDate < now,
        isCancelled: true,
        cancellationReason: reason,
        isOrphan: true,
        rows: [],
      });
    }

    // Sort chronologically (generated + orphaned together)
    occurrenceGroups.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // ── Non-recurring: flat summary numbers ───────────────────────────────────
  const attending = rsvpRows.filter((r) => r.status === "attending");
  const maybe = rsvpRows.filter((r) => r.status === "maybe");
  const declined = rsvpRows.filter((r) => r.status === "declined");
  const totalGuests = attending.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);
  const attendingTotal = attending.length + totalGuests;

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
            ? event.recurrenceEndDate.slice(0, 10)
            : null,
          isAllDay: event.isAllDay,
          extraQuestion: event.extraQuestion,
          extraQuestionType: event.extraQuestionType,
          extraQuestionOptions: event.extraQuestionOptions ?? [],
          extraQuestionRequired: event.extraQuestionRequired,
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
                  extraQuestion={event.extraQuestion}
                  occurrenceGroups={occurrenceGroups.map((g) => ({
                    date: g.date.toISOString(),
                    dateKey: dateKey(g.date),
                    displayDate: g.displayDate,
                    isPast: g.isPast,
                    isCancelled: g.isCancelled,
                    cancellationReason: g.cancellationReason,
                    isOrphan: g.isOrphan,
                    maxAttendees: event.maxAttendees ?? null,
                    rows: g.rows.map((r) => ({
                      id: r.id,
                      userId: r.userId,
                      status: r.status,
                      createdAt: r.createdAt.toISOString(),
                      name: r.userName || r.rsvpName || null,
                      email: r.userEmail || r.rsvpEmail || null,
                      isGuest: !!r.rsvpEmail,
                      guestCount: r.guestCount,
                      extraAnswer: r.extraAnswer,
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
                  <div className="text-2xl font-bold text-green-800">{attendingTotal}</div>
                  <div className="text-xs font-medium text-green-700">Attending</div>
                  <div className="text-[11px] text-green-700/80 mt-0.5">
                    {attending.length} member{attending.length === 1 ? "" : "s"} + {totalGuests} guest{totalGuests === 1 ? "" : "s"}
                  </div>
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
                  <div className="text-xs font-medium text-blue-700">Guests</div>
                </div>
              </div>

              <div className="mt-6">
                <AdminEventRsvpTable
                  eventId={id}
                  members={safeMemberList}
                  extraQuestion={event.extraQuestion}
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
                    extraAnswer: r.extraAnswer,
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
