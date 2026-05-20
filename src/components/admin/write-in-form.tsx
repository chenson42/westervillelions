"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminRsvpRow } from "@/types/admin-rsvp";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WriteInFormProps {
  eventId: string;
  /** Present for recurring events (wall-clock ISO string, same as group.date). Absent for non-recurring. */
  occurrenceDate?: string;
  /** From OccurrenceGroup.maxAttendees or event.maxAttendees. null = no cap. */
  occurrenceCapacity?: number | null;
  /** Count of attending rows for this occurrence (or event, for non-recurring). Used for capacity warning. */
  occurrenceAttendingCount: number;
  /** Called after a successful POST with the new row shape. Component optimistically appends the row. */
  onAdded: (row: AdminRsvpRow) => void;
  /** True when the occurrence is cancelled — hides the entire form. */
  disabled?: boolean;
}

type EmailLookupResult =
  | { id: string; name: string; email: string }
  | null
  | "loading"
  | "idle";

export function WriteInForm({
  eventId,
  occurrenceDate,
  occurrenceCapacity,
  occurrenceAttendingCount,
  onAdded,
  disabled,
}: WriteInFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailLookup, setEmailLookup] = useState<EmailLookupResult>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addingAsMember, setAddingAsMember] = useState(false);

  if (disabled) return null;

  const isAtCapacity =
    occurrenceCapacity != null && occurrenceAttendingCount >= occurrenceCapacity;

  function resetForm() {
    setName("");
    setEmail("");
    setNameError(null);
    setEmailError(null);
    setEmailLookup("idle");
  }

  function handleClose() {
    setIsOpen(false);
    resetForm();
  }

  async function handleEmailBlur() {
    const trimmed = email.trim();

    if (!trimmed) {
      setEmailLookup("idle");
      setEmailError(null);
      return;
    }

    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError("Enter a valid email address");
      setEmailLookup("idle");
      return;
    }

    setEmailError(null);
    setEmailLookup("loading");

    try {
      const res = await fetch(
        `/api/admin/members/lookup?email=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) {
        setEmailLookup(null);
        return;
      }
      const data = await res.json();
      setEmailLookup(data ?? null);
    } catch {
      // Silent fail — do not block the write-in
      setEmailLookup(null);
    }
  }

  async function handleAddAsMember() {
    if (!emailLookup || emailLookup === "loading" || emailLookup === "idle") return;
    setAddingAsMember(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "member",
          userId: emailLookup.id,
          ...(occurrenceDate ? { occurrenceDate } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.alreadyExists) {
        toast.error(data.error ?? "Failed to add member");
        return;
      }
      if (data.alreadyExists) {
        toast.info("Member is already signed up");
        handleClose();
        return;
      }
      onAdded({
        id: data.id,
        userId: emailLookup.id,
        status: "attending",
        createdAt: data.createdAt,
        name: emailLookup.name,
        email: emailLookup.email,
        isGuest: false,
        guestCount: 0,
        extraAnswer: null,
      });
      toast.success("Member added");
      handleClose();
    } finally {
      setAddingAsMember(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Guest name is required.");
      return;
    }
    setNameError(null);

    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("Enter a valid email address");
      return;
    }
    setEmailError(null);

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "guest",
          guestName: trimmedName,
          guestEmail: trimmedEmail || undefined,
          ...(occurrenceDate ? { occurrenceDate } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add guest. Please try again.");
        return;
      }
      onAdded({
        id: data.id,
        userId: null,
        status: "attending",
        createdAt: data.createdAt,
        name: trimmedName,
        email: trimmedEmail || null,
        isGuest: true,
        guestCount: 0,
        extraAnswer: null,
      });
      toast.success("Guest added");
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  const lookupMatch =
    emailLookup !== "idle" && emailLookup !== "loading" && emailLookup !== null
      ? emailLookup
      : null;

  return (
    <div className="px-4 py-3 border-t border-gray-100">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-sm text-lions-blue hover:text-lions-blue-dark font-medium transition"
        >
          + Add write-in guest
        </button>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Guest name *"
                maxLength={200}
                className={`w-full rounded-md border text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                  nameError ? "border-red-400" : "border-gray-300"
                }`}
                aria-label="Guest name"
              />
              {nameError && (
                <p className="mt-0.5 text-xs text-red-600">{nameError}</p>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="Email (optional)"
                className={`w-full rounded-md border text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                  emailError ? "border-red-400" : "border-gray-300"
                }`}
                aria-label="Guest email (optional)"
              />
              {emailError && (
                <p className="mt-0.5 text-xs text-red-600">{emailError}</p>
              )}
              {emailLookup === "loading" && (
                <p className="mt-0.5 text-xs text-gray-400">Looking up…</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-lions-blue text-white px-3 py-1.5 rounded-md text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50"
              >
                {isSubmitting ? "Adding…" : "Add guest"}
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 transition"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Email-match notice */}
          {lookupMatch && (
            <div className="mt-2 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800 flex flex-col sm:flex-row sm:items-center gap-2">
              <span>
                This email belongs to member <strong>{lookupMatch.name}</strong>.
                Add them as a member instead?
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAddAsMember}
                  disabled={addingAsMember}
                  className="text-xs font-semibold text-lions-blue hover:underline disabled:opacity-50"
                >
                  {addingAsMember ? "Adding…" : "Add as Member"}
                </button>
                <button
                  type="button"
                  onClick={() => setEmailLookup(null)}
                  className="text-xs font-semibold text-gray-500 hover:underline"
                >
                  Continue as Guest
                </button>
              </div>
            </div>
          )}

          {/* Capacity warning */}
          {isAtCapacity && (
            <p className="mt-2 text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2 border border-yellow-200">
              This occurrence is at capacity ({occurrenceAttendingCount} /{" "}
              {occurrenceCapacity}). Adding this guest will exceed the limit.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
