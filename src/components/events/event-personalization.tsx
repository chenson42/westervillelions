"use client";

import { useEffect, useState } from "react";
import { OccurrenceSignupList } from "@/components/events/occurrence-signup-list";
import { SingleEventSignup } from "@/components/events/single-event-signup";
import { PublicRsvpForm } from "@/components/public/public-rsvp-form";
import { AttachedFilesList } from "@/components/events/attached-files-list";
import type { AttachedFileSummary } from "@/lib/club-files-queries";
import type { OccurrenceRow } from "@/types/events";

interface ViewerContext {
  isLoggedIn: boolean;
  userName: string | null;
  signedUpDates: string[];
  userRsvp: { status: string; guestCount: number; extraAnswer: string | null } | null;
  attachedFiles: AttachedFileSummary[];
}

interface Props {
  eventId: string;
  requiresRsvp: boolean;
  isRecurring: boolean;
  occurrenceRows: OccurrenceRow[];
  maxAttendees: number | null;
  allowGuestCount: boolean;
  extraQuestion: string | null;
  extraQuestionType: string | null;
  extraQuestionOptions: string[] | null;
  extraQuestionRequired: boolean;
  /** Baseline (session-independent) count/signees for a non-recurring event. */
  singleEventSignedUpCount: number;
  singleEventSignees: string[];
  attachedFilesBaseline: AttachedFileSummary[];
}

/**
 * The session-dependent slice of /events/[id]: RSVP/signup state and the
 * attached-files list. The page's server render passes a signed-out
 * baseline (no occurrence marked "signed up", public files only) so it can
 * be statically cached; this component fetches /api/events/[id]/viewer-context
 * on mount and, once it resolves, remounts the interactive children (via
 * `key`) with the viewer's real state. Same flash-of-signed-out tradeoff as
 * Header — see docs/work-log/2026-09-04-site-review-fixes.md, "Batch 2 —
 * static rendering".
 */
export function EventPersonalization({
  eventId,
  requiresRsvp,
  isRecurring,
  occurrenceRows,
  maxAttendees,
  allowGuestCount,
  extraQuestion,
  extraQuestionType,
  extraQuestionOptions,
  extraQuestionRequired,
  singleEventSignedUpCount,
  singleEventSignees,
  attachedFilesBaseline,
}: Props) {
  const [context, setContext] = useState<ViewerContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/viewer-context`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ViewerContext | null) => {
        if (!cancelled && data) setContext(data);
      })
      .catch(() => {
        /* leave the signed-out baseline in place */
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const isLoggedIn = context?.isLoggedIn ?? false;
  const currentUserName = context?.userName ?? null;
  const attachedFiles = context?.attachedFiles ?? attachedFilesBaseline;
  // Remount the interactive children once real viewer data lands, so their
  // internal (useState-from-props) state reflects it.
  const loadKey = context ? "loaded" : "baseline";

  // signedUpCount/isFull/signees are public aggregates computed server-side
  // and already correct for every viewer (they don't depend on who's
  // asking). Only isSignedUp is personal — patch it in from the viewer
  // context once it loads, matching on the wall-clock rsvpKey (see
  // OccurrenceRow.rsvpKey doc comment).
  const mergedOccurrenceRows: OccurrenceRow[] = context
    ? occurrenceRows.map((row) => ({
        ...row,
        isSignedUp: context.signedUpDates.includes(row.rsvpKey),
      }))
    : occurrenceRows;

  return (
    <>
      {requiresRsvp && (
        <div className="mt-8 mb-10">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            {isRecurring ? "Sign Up for a Date" : "Sign Up"}
          </h2>
          {isRecurring ? (
            <OccurrenceSignupList
              key={loadKey}
              eventId={eventId}
              occurrences={mergedOccurrenceRows}
              maxAttendees={maxAttendees}
              isLoggedIn={isLoggedIn}
              currentUserName={currentUserName}
              extraQuestion={extraQuestion}
              extraQuestionType={extraQuestionType}
              extraQuestionOptions={extraQuestionOptions}
              extraQuestionRequired={extraQuestionRequired}
              showCalendarButtons
            />
          ) : (
            <>
              <SingleEventSignup
                key={loadKey}
                eventId={eventId}
                signedUpCount={singleEventSignedUpCount}
                maxAttendees={maxAttendees}
                isSignedUp={context?.signedUpDates.includes("null") ?? false}
                isLoggedIn={isLoggedIn}
                currentUserName={currentUserName}
                initialSignees={singleEventSignees}
                extraQuestion={extraQuestion}
                extraQuestionType={extraQuestionType}
                extraQuestionOptions={extraQuestionOptions}
                extraQuestionRequired={extraQuestionRequired}
                initialExtraAnswer={context?.userRsvp?.extraAnswer ?? null}
              />
              <div className="mt-6">
                <PublicRsvpForm
                  key={loadKey}
                  eventId={eventId}
                  allowGuestCount={allowGuestCount}
                  isLoggedIn={isLoggedIn}
                  initialStatus={context?.userRsvp?.status ?? null}
                  initialGuestCount={context?.userRsvp?.guestCount ?? 0}
                  extraQuestion={extraQuestion}
                  extraQuestionType={extraQuestionType}
                  extraQuestionOptions={extraQuestionOptions}
                  extraQuestionRequired={extraQuestionRequired}
                  initialExtraAnswer={context?.userRsvp?.extraAnswer ?? null}
                />
              </div>
            </>
          )}
        </div>
      )}

      <AttachedFilesList files={attachedFiles} />
    </>
  );
}
