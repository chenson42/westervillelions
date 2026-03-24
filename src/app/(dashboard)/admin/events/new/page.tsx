import EventForm from "@/components/admin/event-form";
import Link from "next/link";

export default function NewEventPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/events" className="hover:text-gray-900">
            Events
          </Link>
          <span>/</span>
          <span className="text-gray-900">New Event</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Create New Event</h1>
      </div>

      <EventForm />
    </div>
  );
}
