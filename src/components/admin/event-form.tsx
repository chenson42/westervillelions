"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageCropper } from "@/components/admin/image-cropper";

export interface EventFormData {
  title: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  location?: string | null;
  image?: string | null;
  isPublic: boolean;
  isFeatured: boolean;
  requiresRsvp: boolean;
  maxAttendees?: number | null;
  isRecurring: boolean;
  recurrenceType?: string | null;
  recurrenceDays?: number[] | null;
  recurrenceEndDate?: string | null;
}

// ── DateTime helpers ─────────────────────────────────────────────────────────

function parseDateTime(value: string) {
  if (!value || value.length < 16) return { date: "", hour: 12, minute: 0, isPm: false };
  const date = value.slice(0, 10);
  const h24 = parseInt(value.slice(11, 13));
  const m = parseInt(value.slice(14, 16));
  return { date, hour: h24 % 12 || 12, minute: m, isPm: h24 >= 12 };
}

function buildDateTime(date: string, hour12: number, minute: number, isPm: boolean): string {
  if (!date) return "";
  const h = (hour12 % 12) + (isPm ? 12 : 0);
  return `${date}T${h.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function addOneHour(value: string): string {
  if (!value || value.length < 16) return "";
  const date = value.slice(0, 10);
  const h = parseInt(value.slice(11, 13));
  const m = parseInt(value.slice(14, 16));
  const total = h * 60 + m + 60;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  if (total >= 24 * 60) {
    const d = new Date(date + "T00:00");
    d.setDate(d.getDate() + 1);
    return `${d.toISOString().slice(0, 10)}T${newH.toString().padStart(2, "0")}:${newM.toString().padStart(2, "0")}`;
  }
  return `${date}T${newH.toString().padStart(2, "0")}:${newM.toString().padStart(2, "0")}`;
}

const dtInputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue";

function DateTimePicker({
  id,
  value,
  onDateChange,
  onTimeChange,
  required,
}: {
  id: string;
  value: string;
  onDateChange: (newValue: string) => void;
  onTimeChange: (newValue: string) => void;
  required?: boolean;
}) {
  const { date, hour, minute, isPm } = parseDateTime(value);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input
        type="date"
        id={id}
        required={required}
        value={date}
        onChange={(e) => onDateChange(buildDateTime(e.target.value, hour, minute, isPm))}
        className={dtInputClass}
      />
      <div className="flex items-center gap-1">
        <select
          value={hour}
          onChange={(e) => onTimeChange(buildDateTime(date, Number(e.target.value), minute, isPm))}
          className={dtInputClass}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-gray-500 text-sm">:</span>
        <select
          value={minute}
          onChange={(e) => onTimeChange(buildDateTime(date, hour, Number(e.target.value), isPm))}
          className={dtInputClass}
        >
          {[0, 15, 30, 45].map((m) => (
            <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>
          ))}
        </select>
        <select
          value={isPm ? "PM" : "AM"}
          onChange={(e) => onTimeChange(buildDateTime(date, hour, minute, e.target.value === "PM"))}
          className={dtInputClass}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

export default function EventForm({
  event,
  eventId,
}: {
  event?: EventFormData;
  eventId?: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<EventFormData>(
    event || {
      title: "",
      startDate: "",
      isPublic: false,
      isFeatured: false,
      requiresRsvp: false,
      isRecurring: false,
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = eventId ? `/api/admin/events/${eventId}` : "/api/admin/events";
      const method = eventId ? "PATCH" : "POST";

      // Normalise recurrence fields: clear them when not recurring
      const payload: EventFormData = { ...formData };
      if (!payload.isRecurring) {
        payload.recurrenceType = null;
        payload.recurrenceDays = null;
        payload.recurrenceEndDate = null;
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save event");
      }

      toast.success(eventId ? "Event updated successfully" : "Event created successfully");
      router.push("/admin/events");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : type === "number"
          ? parseInt(value, 10) || null
          : value || null,
    }));
  };

  const handleDayToggle = (day: number) => {
    setFormData((prev) => {
      const current = prev.recurrenceDays ?? [];
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      return { ...prev, recurrenceDays: next };
    });
  };

  const handleDelete = async () => {
    if (!eventId || !confirm("Are you sure you want to delete this event?")) return;

    try {
      const response = await fetch(`/api/admin/events/${eventId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete event");
      toast.success("Event deleted");
      router.push("/admin/events");
      router.refresh();
    } catch {
      toast.error("Failed to delete event");
    }
  };

  const showDaysOfWeek =
    formData.isRecurring &&
    (formData.recurrenceType === "weekly" || formData.recurrenceType === "biweekly");

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Information */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Event Information</h2>
        <div className="mt-6 space-y-6">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">
              Title *
            </label>
            <input
              type="text"
              id="title"
              name="title"
              required
              value={formData.title}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              value={formData.description || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label htmlFor="location" className="block text-sm font-medium text-gray-700">
              Location
            </label>
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location || ""}
              onChange={handleChange}
              placeholder="e.g. Westerville Community Center"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>
        </div>
      </div>

      {/* Date & Time */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Date &amp; Time</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
              Start Date &amp; Time *
            </label>
            <DateTimePicker
              id="startDate"
              value={formData.startDate || ""}
              required
              onDateChange={(newStart) => {
                const newDatePart = newStart.slice(0, 10);
                // Sync end date to match; keep existing end time or mirror start time
                const endTimeSuffix = formData.endDate
                  ? formData.endDate.slice(10)
                  : newStart.slice(10);
                setFormData((prev) => ({
                  ...prev,
                  startDate: newStart,
                  endDate: newDatePart ? `${newDatePart}${endTimeSuffix}` : prev.endDate,
                }));
              }}
              onTimeChange={(newStart) => {
                setFormData((prev) => ({
                  ...prev,
                  startDate: newStart,
                  endDate: addOneHour(newStart),
                }));
              }}
            />
          </div>

          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
              End Date &amp; Time
            </label>
            <DateTimePicker
              id="endDate"
              value={formData.endDate || ""}
              onDateChange={(newEnd) => setFormData((prev) => ({ ...prev, endDate: newEnd || null }))}
              onTimeChange={(newEnd) => setFormData((prev) => ({ ...prev, endDate: newEnd || null }))}
            />
          </div>
        </div>
      </div>

      {/* Recurring Event */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recurring Event</h2>
        <div className="mt-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="isRecurring"
              name="isRecurring"
              checked={formData.isRecurring}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
            />
            <label htmlFor="isRecurring" className="ml-2 block text-sm text-gray-700">
              This is a recurring event
            </label>
          </div>

          {formData.isRecurring && (
            <div className="mt-6 space-y-6">
              {/* Recurrence type */}
              <div>
                <label htmlFor="recurrenceType" className="block text-sm font-medium text-gray-700">
                  Repeat
                </label>
                <select
                  id="recurrenceType"
                  name="recurrenceType"
                  value={formData.recurrenceType || ""}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                >
                  <option value="">Select frequency...</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly (every other week)</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              {/* Days of week — only for weekly/biweekly */}
              {showDaysOfWeek && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Days of the week
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map(({ label, value }) => {
                      const selected = (formData.recurrenceDays ?? []).includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleDayToggle(value)}
                          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                            selected
                              ? "bg-lions-blue text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Series end date */}
              <div>
                <label htmlFor="recurrenceEndDate" className="block text-sm font-medium text-gray-700">
                  Series ends on
                </label>
                <input
                  type="date"
                  id="recurrenceEndDate"
                  name="recurrenceEndDate"
                  value={formData.recurrenceEndDate || ""}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue sm:w-48"
                />
                <p className="mt-1 text-xs text-gray-500">Leave blank for an open-ended series.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="maxAttendees" className="block text-sm font-medium text-gray-700">
              Max Attendees (optional)
            </label>
            <input
              type="number"
              id="maxAttendees"
              name="maxAttendees"
              value={formData.maxAttendees || ""}
              onChange={handleChange}
              min="1"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Event Image (optional)
            </label>
            <ImageCropper
              value={formData.image}
              onChange={(dataUrl) => setFormData((prev) => ({ ...prev, image: dataUrl }))}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="isPublic"
                name="isPublic"
                checked={formData.isPublic}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
              />
              <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-700">
                Public (visible on public events page)
              </label>
            </div>
            <div className="flex items-start">
              <input
                type="checkbox"
                id="isFeatured"
                name="isFeatured"
                checked={formData.isFeatured}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue mt-0.5"
              />
              <div className="ml-2">
                <label htmlFor="isFeatured" className="block text-sm text-gray-700">
                  Featured on homepage
                </label>
                <p className="text-xs text-gray-500">
                  Shows this event in the &quot;What&apos;s Happening&quot; section. Only the next upcoming featured event is shown.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="requiresRsvp"
                name="requiresRsvp"
                checked={formData.requiresRsvp}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
              />
              <label htmlFor="requiresRsvp" className="ml-2 block text-sm text-gray-700">
                Requires RSVP
              </label>
            </div>
            <p className="mt-1 ml-6 text-xs text-gray-500">
              Members will be prompted to RSVP for this event
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        {eventId && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50"
          >
            Delete Event
          </button>
        )}
        <div className="flex gap-4 ml-auto">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : eventId ? "Update Event" : "Create Event"}
          </button>
        </div>
      </div>
    </form>
  );
}
