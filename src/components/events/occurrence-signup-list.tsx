"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { OccurrenceRow } from "@/types/events";

interface OccurrenceSignupListProps {
  eventId: string;
  occurrences: OccurrenceRow[];
  maxAttendees: number | null;
  isLoggedIn: boolean;
  currentUserName?: string | null;
}

export function OccurrenceSignupList({
  eventId,
  occurrences,
  maxAttendees,
  isLoggedIn,
  currentUserName,
}: OccurrenceSignupListProps) {
  const [rows, setRows] = useState<OccurrenceRow[]>(occurrences);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);

  async function handleToggle(row: OccurrenceRow) {
    if (loadingDate) return;

    const wasSignedUp = row.isSignedUp;

    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        r.date === row.date
          ? {
              ...r,
              isSignedUp: !wasSignedUp,
              signedUpCount: wasSignedUp ? r.signedUpCount - 1 : r.signedUpCount + 1,
              isFull:
                maxAttendees != null
                  ? (!wasSignedUp ? r.signedUpCount + 1 : r.signedUpCount - 1) >= maxAttendees
                  : false,
              signees: currentUserName
                ? wasSignedUp
                  ? r.signees.filter((n) => n !== currentUserName)
                  : [...r.signees, currentUserName]
                : r.signees,
            }
          : r
      )
    );
    setLoadingDate(row.date);

    try {
      const method = wasSignedUp ? "DELETE" : "POST";
      const res = await fetch(`/api/events/${eventId}/signup`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceDate: row.date }),
      });

      if (res.status === 409) {
        // Race condition — slot was taken
        setRows((prev) =>
          prev.map((r) =>
            r.date === row.date
              ? {
                  ...r,
                  isSignedUp: false,
                  isFull: true,
                  signedUpCount: r.signedUpCount - 1,
                  signees: currentUserName ? r.signees.filter((n) => n !== currentUserName) : r.signees,
                }
              : r
          )
        );
        toast.error("That occurrence is now full. Try a different date.");
        return;
      }

      if (!res.ok) {
        throw new Error("Request failed");
      }

      toast.success(wasSignedUp ? "Signup cancelled." : "You're signed up!");
    } catch {
      // Revert optimistic update on error
      setRows((prev) =>
        prev.map((r) =>
          r.date === row.date
            ? {
                ...r,
                isSignedUp: wasSignedUp,
                signedUpCount: wasSignedUp ? r.signedUpCount + 1 : r.signedUpCount - 1,
                isFull:
                  maxAttendees != null
                    ? (wasSignedUp ? r.signedUpCount + 1 : r.signedUpCount - 1) >= maxAttendees
                    : false,
                signees: currentUserName
                  ? wasSignedUp
                    ? [...r.signees, currentUserName]
                    : r.signees.filter((n) => n !== currentUserName)
                  : r.signees,
              }
            : r
        )
      );
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoadingDate(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No upcoming dates available.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => {
          const isLoading = loadingDate === row.date;

          return (
            <li
              key={row.date}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 ${
                row.isPast ? "opacity-60" : ""
              }`}
            >
              {/* Date + count + signees */}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{row.displayDate}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {maxAttendees != null
                    ? `${row.signedUpCount} / ${maxAttendees} spots`
                    : `${row.signedUpCount} signed up`}
                </p>
                {isLoggedIn && row.signees.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.signees.map((name) => (
                      <span key={name} className="inline-block bg-lions-blue/10 text-lions-blue text-xs font-medium px-2 py-0.5 rounded-full">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="flex-shrink-0">
                {!isLoggedIn ? (
                  <Link
                    href="/signin"
                    className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                  >
                    Log in to sign up
                  </Link>
                ) : row.isPast ? (
                  <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-gray-400 cursor-default">
                    Closed
                  </span>
                ) : row.isFull && !row.isSignedUp ? (
                  <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-gray-400 bg-gray-100 cursor-not-allowed">
                    Full
                  </span>
                ) : row.isSignedUp ? (
                  <button
                    onClick={() => handleToggle(row)}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-1"
                  >
                    {isLoading ? "..." : "Signed Up \u2713"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggle(row)}
                    disabled={isLoading}
                    className="inline-flex items-center rounded-lg border-2 border-lions-blue text-lions-blue px-4 py-2 text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-1"
                  >
                    {isLoading ? "..." : "Sign Up"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
