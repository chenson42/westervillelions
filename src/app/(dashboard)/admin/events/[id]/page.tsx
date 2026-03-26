import EventForm from "@/components/admin/event-form";
import { db } from "@/lib/db";
import { events, eventRsvps, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [event, rsvpRows] = await Promise.all([
    db.query.events.findFirst({
      where: eq(events.id, id),
    }),
    db
      .select({
        id: eventRsvps.id,
        status: eventRsvps.status,
        guestCount: eventRsvps.guestCount,
        createdAt: eventRsvps.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(eventRsvps)
      .innerJoin(users, eq(eventRsvps.userId, users.id))
      .where(eq(eventRsvps.eventId, id))
      .orderBy(eventRsvps.createdAt),
  ]);

  if (!event) notFound();

  // Format dates for datetime-local input (YYYY-MM-DDTHH:mm)
  const toInputValue = (date: Date | null) =>
    date ? new Date(date).toISOString().slice(0, 16) : "";

  const attending = rsvpRows.filter((r) => r.status === "attending");
  const maybe = rsvpRows.filter((r) => r.status === "maybe");
  const declined = rsvpRows.filter((r) => r.status === "declined");
  const totalGuests = attending.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);

  const showRsvpSection = event.requiresRsvp || rsvpRows.length > 0;

  const statusBadge = (status: string) => {
    if (status === "attending")
      return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-green-100 text-green-800";
    if (status === "maybe")
      return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-yellow-100 text-yellow-800";
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-red-100 text-red-800";
  };

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
          requiresRsvp: event.requiresRsvp,
          maxAttendees: event.maxAttendees,
        }}
      />

      {showRsvpSection && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">RSVP Details</h2>

          {/* Summary counts */}
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

          {/* RSVP table */}
          {rsvpRows.length > 0 ? (
            <div className="mt-6 overflow-hidden rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Guests
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Date RSVPd
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {rsvpRows.map((rsvp) => (
                    <tr key={rsvp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {rsvp.userName || "—"}
                        </div>
                        <div className="text-xs text-gray-500">{rsvp.userEmail}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={statusBadge(rsvp.status)}>
                          {rsvp.status.charAt(0).toUpperCase() + rsvp.status.slice(1)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {rsvp.guestCount ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {new Date(rsvp.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">No RSVPs yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
