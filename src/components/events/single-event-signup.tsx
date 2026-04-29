"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

interface SingleEventSignupProps {
  eventId: string;
  signedUpCount: number;
  maxAttendees: number | null;
  isSignedUp: boolean;
  isLoggedIn: boolean;
  currentUserName?: string | null;
  initialSignees?: string[];
}

export function SingleEventSignup({
  eventId,
  signedUpCount: initialCount,
  maxAttendees,
  isSignedUp: initialSignedUp,
  isLoggedIn,
  currentUserName,
  initialSignees = [],
}: SingleEventSignupProps) {
  const [isSignedUp, setIsSignedUp] = useState(initialSignedUp);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [signees, setSignees] = useState<string[]>(initialSignees);

  const isFull = maxAttendees != null && count >= maxAttendees && !isSignedUp;

  async function handleToggle() {
    if (loading) return;

    const wasSignedUp = isSignedUp;

    // Optimistic update
    setIsSignedUp(!wasSignedUp);
    setCount((c) => (wasSignedUp ? c - 1 : c + 1));
    if (currentUserName) {
      setSignees((prev) =>
        wasSignedUp ? prev.filter((n) => n !== currentUserName) : [...prev, currentUserName]
      );
    }
    setLoading(true);

    try {
      const method = wasSignedUp ? "DELETE" : "POST";
      const res = await fetch(`/api/events/${eventId}/signup`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.status === 409) {
        // Revert — slot was taken
        setIsSignedUp(wasSignedUp);
        setCount((c) => (wasSignedUp ? c + 1 : c - 1));
        if (currentUserName) {
          setSignees((prev) =>
            wasSignedUp ? [...prev, currentUserName] : prev.filter((n) => n !== currentUserName)
          );
        }
        toast.error("This event is now full.");
        return;
      }

      if (!res.ok) {
        throw new Error("Request failed");
      }

      toast.success(wasSignedUp ? "Signup cancelled." : "You're signed up!");
    } catch {
      // Revert optimistic update
      setIsSignedUp(wasSignedUp);
      setCount((c) => (wasSignedUp ? c + 1 : c - 1));
      if (currentUserName) {
        setSignees((prev) =>
          wasSignedUp ? [...prev, currentUserName] : prev.filter((n) => n !== currentUserName)
        );
      }
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      {/* Count display */}
      <p className="text-sm text-gray-600">
        {maxAttendees != null ? (
          <>
            <span className="font-semibold text-gray-900">{count}</span> of{" "}
            <span className="font-semibold text-gray-900">{maxAttendees}</span> spots filled
          </>
        ) : (
          <>
            <span className="font-semibold text-gray-900">{count}</span> signed up
          </>
        )}
      </p>

      {/* Action */}
      {!isLoggedIn ? (
        <Link
          href="/signin"
          className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          Log in to sign up
        </Link>
      ) : isFull ? (
        <span className="inline-flex items-center rounded-lg px-6 py-3 text-sm font-semibold text-gray-400 bg-gray-100 cursor-not-allowed">
          Full
        </span>
      ) : isSignedUp ? (
        <button
          onClick={handleToggle}
          disabled={loading}
          className="rounded-lg bg-lions-blue px-6 py-3 text-sm font-semibold text-white hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-1"
        >
          {loading ? "..." : "Signed Up \u2713"}
        </button>
      ) : (
        <button
          onClick={handleToggle}
          disabled={loading}
          className="rounded-lg border-2 border-lions-blue text-lions-blue px-6 py-3 text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-1"
        >
          {loading ? "..." : "Sign Up"}
        </button>
      )}

      {isLoggedIn && signees.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Signed up:</p>
          <div className="flex flex-wrap gap-1.5">
            {signees.map((name) => (
              <span key={name} className="inline-block bg-lions-blue/10 text-lions-blue text-xs font-medium px-2 py-0.5 rounded-full">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
