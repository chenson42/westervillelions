"use client";

import { useState } from "react";
import { toast } from "sonner";

type RsvpStatus = "attending" | "maybe" | "declined" | null;

export function EventRsvp({
  eventId,
  initialStatus,
}: {
  eventId: string;
  initialStatus: RsvpStatus;
}) {
  const [status, setStatus] = useState<RsvpStatus>(initialStatus);
  const [isSaving, setIsSaving] = useState(false);

  async function handleRsvp(newStatus: RsvpStatus) {
    if (isSaving) return;
    setIsSaving(true);

    try {
      if (newStatus === null) {
        const res = await fetch(`/api/events/${eventId}/rsvp`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to remove RSVP");
        setStatus(null);
        toast.success("RSVP removed");
      } else {
        const res = await fetch(`/api/events/${eventId}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Failed to save RSVP");
        setStatus(newStatus);
        const labels: Record<string, string> = {
          attending: "You're attending!",
          maybe: "Marked as maybe",
          declined: "RSVP declined",
        };
        toast.success(labels[newStatus]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update RSVP");
    } finally {
      setIsSaving(false);
    }
  }

  const buttons: { value: RsvpStatus; label: string; activeClass: string }[] = [
    { value: "attending", label: "Attending", activeClass: "bg-green-600 text-white border-green-600" },
    { value: "maybe", label: "Maybe", activeClass: "bg-yellow-500 text-white border-yellow-500" },
    { value: "declined", label: "Decline", activeClass: "bg-gray-500 text-white border-gray-500" },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 mr-1">RSVP:</span>
      {buttons.map((btn) => (
        <button
          key={btn.value}
          onClick={() => handleRsvp(status === btn.value ? null : btn.value)}
          disabled={isSaving}
          className={`px-3 py-1 text-sm rounded-full border font-medium transition disabled:opacity-50 ${
            status === btn.value
              ? btn.activeClass
              : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
          }`}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
