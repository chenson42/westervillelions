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
  extraQuestion?: string | null;
  extraQuestionType?: string | null;
  extraQuestionOptions?: string[] | null;
  extraQuestionRequired?: boolean;
  initialExtraAnswer?: string | null;
}

export function SingleEventSignup({
  eventId,
  signedUpCount: initialCount,
  maxAttendees,
  isSignedUp: initialSignedUp,
  isLoggedIn,
  currentUserName,
  initialSignees = [],
  extraQuestion,
  extraQuestionType,
  extraQuestionOptions,
  extraQuestionRequired,
  initialExtraAnswer,
}: SingleEventSignupProps) {
  const [isSignedUp, setIsSignedUp] = useState(initialSignedUp);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [signees, setSignees] = useState<string[]>(initialSignees);
  const [extraAnswer, setExtraAnswer] = useState<string>(initialExtraAnswer ?? "");

  const isFull = maxAttendees != null && count >= maxAttendees && !isSignedUp;

  async function handleToggle() {
    if (loading) return;

    const wasSignedUp = isSignedUp;

    // Validate required extra question on signup
    if (
      !wasSignedUp &&
      extraQuestion &&
      extraQuestionRequired &&
      extraAnswer.trim().length === 0
    ) {
      toast.error(`${extraQuestion} is required`);
      return;
    }

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
        body: JSON.stringify(wasSignedUp ? {} : { extraAnswer: extraAnswer.trim() }),
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

  const showExtraQuestion = Boolean(extraQuestion) && isLoggedIn;
  const options = (extraQuestionOptions ?? []) as string[];
  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue";

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      {/* Count display — total includes guests */}
      <p className="text-sm text-gray-600">
        {maxAttendees != null ? (
          <>
            <span className="font-semibold text-gray-900">{count}</span> of{" "}
            <span className="font-semibold text-gray-900">{maxAttendees}</span> spots filled
            <span className="text-gray-400"> (incl. guests)</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-gray-900">{count}</span> attendees
            <span className="text-gray-400"> (incl. guests)</span>
          </>
        )}
      </p>

      {showExtraQuestion && !isSignedUp && (
        <div>
          <label htmlFor="single-extra-answer" className="block text-sm font-medium text-gray-700">
            {extraQuestion}
            {extraQuestionRequired && <span className="text-red-600"> *</span>}
          </label>
          {extraQuestionType === "select" ? (
            <select
              id="single-extra-answer"
              value={extraAnswer}
              onChange={(e) => setExtraAnswer(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="single-extra-answer"
              type="text"
              value={extraAnswer}
              onChange={(e) => setExtraAnswer(e.target.value)}
              className={inputClass}
            />
          )}
        </div>
      )}

      {showExtraQuestion && isSignedUp && extraAnswer && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">{extraQuestion}</span> {extraAnswer}
        </p>
      )}

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
