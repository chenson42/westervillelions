import EventForm from "@/components/admin/event-form";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await db.query.events.findFirst({
    where: eq(events.id, id),
  });

  if (!event) notFound();

  // Format dates for datetime-local input (YYYY-MM-DDTHH:mm)
  const toInputValue = (date: Date | null) =>
    date ? new Date(date).toISOString().slice(0, 16) : "";

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
          maxAttendees: event.maxAttendees,
        }}
      />
    </div>
  );
}
