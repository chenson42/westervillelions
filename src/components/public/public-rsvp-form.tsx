"use client";

import { useState } from "react";
import { toast } from "sonner";

type RsvpStatus = "attending" | "maybe" | "declined";

interface Props {
  eventId: string;
  allowGuestCount: boolean;
  isLoggedIn: boolean;
  initialStatus?: string | null;
  initialGuestCount?: number;
}

const STATUS_BUTTONS: { value: RsvpStatus; label: string; activeClass: string }[] = [
  { value: "attending", label: "Attending", activeClass: "bg-green-600 text-white border-green-600" },
  { value: "maybe", label: "Maybe", activeClass: "bg-yellow-500 text-white border-yellow-500" },
  { value: "declined", label: "Decline", activeClass: "bg-gray-500 text-white border-gray-500" },
];

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue";

// ── Logged-in user RSVP ───────────────────────────────────────────────────────

function AuthenticatedRsvpForm({
  eventId,
  allowGuestCount,
  initialStatus,
  initialGuestCount,
}: {
  eventId: string;
  allowGuestCount: boolean;
  initialStatus?: string | null;
  initialGuestCount?: number;
}) {
  const [status, setStatus] = useState<RsvpStatus | null>(
    (initialStatus as RsvpStatus) ?? null
  );
  const [guestCount, setGuestCount] = useState<number>(initialGuestCount ?? 0);
  const [isSaving, setIsSaving] = useState(false);

  async function handleRsvp(newStatus: RsvpStatus) {
    if (isSaving) return;

    // Toggle off if clicking the current status
    const targetStatus = status === newStatus ? null : newStatus;
    setIsSaving(true);

    try {
      if (targetStatus === null) {
        const res = await fetch(`/api/events/${eventId}/rsvp`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to remove RSVP");
        setStatus(null);
        toast.success("RSVP removed");
      } else {
        const res = await fetch(`/api/events/${eventId}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus, guestCount }),
        });
        if (!res.ok) throw new Error("Failed to save RSVP");
        setStatus(targetStatus);
        const labels: Record<RsvpStatus, string> = {
          attending: "You're attending!",
          maybe: "Marked as maybe",
          declined: "RSVP declined",
        };
        toast.success(labels[targetStatus]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update RSVP");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGuestCountChange(count: number) {
    if (!status) return;
    setGuestCount(count);
    try {
      const res = await fetch(`/api/events/${eventId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, guestCount: count }),
      });
      if (!res.ok) throw new Error("Failed to update guest count");
    } catch {
      toast.error("Failed to update guest count");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-600 mr-1">Your response:</span>
        {STATUS_BUTTONS.map((btn) => (
          <button
            key={btn.value}
            onClick={() => handleRsvp(btn.value)}
            disabled={isSaving}
            className={`px-4 py-2 text-sm rounded-lg border font-medium transition disabled:opacity-50 ${
              status === btn.value
                ? btn.activeClass
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {allowGuestCount && status === "attending" && (
        <div className="flex items-center gap-3">
          <label htmlFor="auth-guest-count" className="text-sm font-medium text-gray-700">
            Guests bringing:
          </label>
          <input
            id="auth-guest-count"
            type="number"
            min={0}
            max={20}
            value={guestCount}
            onChange={(e) => handleGuestCountChange(parseInt(e.target.value, 10) || 0)}
            className="w-20 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
      )}
    </div>
  );
}

// ── Anonymous user RSVP ───────────────────────────────────────────────────────

function AnonymousRsvpForm({
  eventId,
  allowGuestCount,
}: {
  eventId: string;
  allowGuestCount: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<RsvpStatus>("attending");
  const [guestCount, setGuestCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ name: string; status: RsvpStatus } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!email.trim()) {
      toast.error("Please enter your email address");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), status, guestCount }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit RSVP");
      }

      setConfirmed({ name: name.trim(), status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit RSVP");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (confirmed) {
    const labels: Record<RsvpStatus, string> = {
      attending: "attending",
      maybe: "marked as maybe",
      declined: "declined",
    };
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-5">
        <p className="text-green-800 font-semibold text-base mb-1">You&apos;re all set, {confirmed.name}!</p>
        <p className="text-green-700 text-sm">
          You&apos;ve been {labels[confirmed.status]} for this event. To update your RSVP, simply
          submit the form again using the same email address.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rsvp-name" className="block text-sm font-medium text-gray-700">
            Your Name *
          </label>
          <input
            id="rsvp-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="rsvp-email" className="block text-sm font-medium text-gray-700">
            Email Address *
          </label>
          <input
            id="rsvp-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Will you attend?</p>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_BUTTONS.map((btn) => (
            <button
              key={btn.value}
              type="button"
              onClick={() => setStatus(btn.value)}
              className={`px-4 py-2 text-sm rounded-lg border font-medium transition ${
                status === btn.value
                  ? btn.activeClass
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {allowGuestCount && status === "attending" && (
        <div className="flex items-center gap-3">
          <label htmlFor="anon-guest-count" className="text-sm font-medium text-gray-700">
            Number of guests:
          </label>
          <input
            id="anon-guest-count"
            type="number"
            min={0}
            max={20}
            value={guestCount}
            onChange={(e) => setGuestCount(parseInt(e.target.value, 10) || 0)}
            className="w-20 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50"
      >
        {isSubmitting ? "Submitting..." : "Submit RSVP"}
      </button>
    </form>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PublicRsvpForm({
  eventId,
  allowGuestCount,
  isLoggedIn,
  initialStatus,
  initialGuestCount,
}: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">RSVP for this Event</h2>
      {isLoggedIn ? (
        <AuthenticatedRsvpForm
          eventId={eventId}
          allowGuestCount={allowGuestCount}
          initialStatus={initialStatus}
          initialGuestCount={initialGuestCount}
        />
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            No account needed — just enter your name and email below.
          </p>
          <AnonymousRsvpForm eventId={eventId} allowGuestCount={allowGuestCount} />
        </>
      )}
    </div>
  );
}
