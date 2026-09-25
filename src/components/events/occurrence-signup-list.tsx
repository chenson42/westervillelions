"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { OccurrenceRow } from "@/types/events";
import { AddToCalendarDropdown } from "@/components/events/add-to-calendar-dropdown";

interface OccurrenceSignupListProps {
  eventId: string;
  occurrences: OccurrenceRow[];
  maxAttendees: number | null;
  isLoggedIn: boolean;
  currentUserName?: string | null;
  extraQuestion?: string | null;
  extraQuestionType?: string | null;
  extraQuestionOptions?: string[] | null;
  extraQuestionRequired?: boolean;
  /** When true, renders a per-occurrence "Add to Calendar" anchor on each row. */
  showCalendarButtons?: boolean;
  /**
   * Status of the client-side viewer-context fetch that supplies real
   * signee names and the signed-in RSVP state (see EventPersonalization).
   * "loading" and "error" render a small status strip above the list so a
   * slow or failed fetch is never indistinguishable from a genuinely empty
   * roster — the exact complaint that started this fix. Defaults to "ready"
   * for callers (and tests) that don't track this.
   */
  rosterStatus?: "loading" | "ready" | "error";
  /** Retries the viewer-context fetch after a failure. Required when rosterStatus can be "error". */
  onRetryRoster?: () => void;
}

export function OccurrenceSignupList({
  eventId,
  occurrences,
  maxAttendees,
  isLoggedIn,
  currentUserName,
  extraQuestion,
  extraQuestionType,
  extraQuestionOptions,
  extraQuestionRequired,
  showCalendarButtons = false,
  rosterStatus = "ready",
  onRetryRoster,
}: OccurrenceSignupListProps) {
  const [rows, setRows] = useState<OccurrenceRow[]>(occurrences);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [extraAnswer, setExtraAnswer] = useState<string>("");
  // Default closed, EXCEPT when the series has no upcoming rows at all (the
  // season-ending case, e.g. the last Farmers Market of the year already
  // happened): with nothing upcoming to show above the fold, collapsing the
  // only content on the page would make it look empty/broken instead of
  // just requiring one click.
  const [showPast, setShowPast] = useState(
    () => occurrences.length > 0 && occurrences.every((r) => r.isPast)
  );

  async function handleToggle(row: OccurrenceRow) {
    if (loadingDate) return;

    const wasSignedUp = row.isSignedUp;

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
        body: JSON.stringify(
          wasSignedUp
            ? { occurrenceDate: row.date }
            : { occurrenceDate: row.date, extraAnswer: extraAnswer.trim() }
        ),
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

  const showExtraQuestion = Boolean(extraQuestion) && isLoggedIn;
  const options = (extraQuestionOptions ?? []) as string[];
  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue";

  // Keep the next upcoming date at the top of the viewport; a long-running
  // series (e.g. a year of weekly markets) shouldn't dump dozens of past rows
  // above the fold. Past dates — including their signee rosters, which is the
  // whole point of keeping them reachable — live behind a collapsed
  // disclosure that defaults closed.
  const upcomingRows = rows.filter((r) => !r.isPast);
  const pastRows = rows.filter((r) => r.isPast);

  const renderRow = (row: OccurrenceRow) => {
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
          {/* DECISION-004: suppress signup count on cancelled rows */}
          {!row.isCancelled && (
            <p className="mt-0.5 text-xs text-gray-500">
              {maxAttendees != null
                ? `${row.signedUpCount} / ${maxAttendees} spots (incl. guests)`
                : row.signedUpCount === 0
                  ? "Be the first to sign up"
                  : `${row.signedUpCount} attendees (incl. guests)`}
            </p>
          )}
          {row.isCancelled && row.cancellationReason && (
            <p className="mt-0.5 text-xs text-gray-400 italic">
              {row.cancellationReason}
            </p>
          )}
          {row.isCancelled && row.isSignedUp && (
            <p className="mt-1 text-xs text-amber-700 font-medium">
              You were signed up for this date.
            </p>
          )}
          {!row.isCancelled && isLoggedIn && row.signees.length > 0 && (
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
        <div className="flex-shrink-0 flex flex-wrap items-center gap-2">
          {showCalendarButtons && !row.isCancelled && (
            <AddToCalendarDropdown
              eventId={eventId}
              occurrence={row.dateKey}
              googleUrl={row.googleUrl}
              outlookUrl={row.outlookUrl}
            />
          )}
          {row.isCancelled ? (
            <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 cursor-default">
              Cancelled
            </span>
          ) : !isLoggedIn ? (
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
              {isLoading ? "..." : "Signed Up ✓"}
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
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      {showExtraQuestion && (
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <label htmlFor="occ-extra-answer" className="block text-sm font-medium text-gray-700">
            {extraQuestion}
            {extraQuestionRequired && <span className="text-red-600"> *</span>}
          </label>
          <p className="mt-0.5 text-xs text-gray-500">
            Your answer will be saved with each date you sign up for.
          </p>
          {extraQuestionType === "select" ? (
            <select
              id="occ-extra-answer"
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
              id="occ-extra-answer"
              type="text"
              value={extraAnswer}
              onChange={(e) => setExtraAnswer(e.target.value)}
              className={inputClass}
            />
          )}
        </div>
      )}
      {rosterStatus === "loading" && (
        <div
          className="flex items-center gap-2 px-6 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100"
          aria-live="polite"
        >
          <span
            className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-gray-300 border-t-lions-blue animate-spin"
            aria-hidden="true"
          />
          Loading who&apos;s signed up…
        </div>
      )}
      {rosterStatus === "error" && (
        <div
          className="flex items-center justify-between gap-2 px-6 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100"
          aria-live="polite"
        >
          <span>Couldn&apos;t load who&apos;s signed up.</span>
          <button
            type="button"
            onClick={onRetryRoster}
            className="font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            Retry
          </button>
        </div>
      )}
      {upcomingRows.length > 0 && (
        <ul className="divide-y divide-gray-100">{upcomingRows.map(renderRow)}</ul>
      )}
      {/* rows.length === 0 is handled by the early return above, so reaching here with
          zero upcoming rows means every occurrence is past — nothing to say beyond the
          "Show N past dates" disclosure below. */}

      {pastRows.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="w-full flex items-center justify-between gap-2 px-6 py-3 text-sm font-semibold text-lions-blue hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
          >
            <span>
              {showPast
                ? "Hide past dates"
                : `Show ${pastRows.length} past date${pastRows.length === 1 ? "" : "s"}`}
            </span>
            <svg
              className={`h-4 w-4 flex-shrink-0 transition-transform ${showPast ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showPast && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {pastRows.map(renderRow)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
