import Link from "next/link";
import { format } from "date-fns";
import { minutesKindLabel } from "@/lib/minutes";
import type { NextMeetingPointer as NextMeetingPointerData, MostRecentApprovedMinutes } from "@/lib/minutes-queries";

interface NextMeetingPointerProps {
  kind: string;
  pointer: NextMeetingPointerData | null;
  mostRecentApproved: MostRecentApprovedMinutes | null;
}

/**
 * "Next meeting" widget on /members/records (Phase 3 Flow 1) — reads the
 * next scheduled occurrence of the club's recurring meeting event via
 * `getNextMeetingPointer()` (never duplicates Events' own occurrence math),
 * with a link to the most recent APPROVED minutes of the matching kind —
 * "Read {date}'s minutes" is the approval-workflow link, not just a
 * convenience (a member clicking through should land on the official
 * record, never an in-progress draft — Flow 1).
 */
export function NextMeetingPointer({ kind, pointer, mostRecentApproved }: NextMeetingPointerProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Next {minutesKindLabel(kind)} Meeting
      </h2>
      {pointer ? (
        <div>
          <p className="text-lg font-semibold text-gray-900">{pointer.title}</p>
          <p className="text-gray-600">
            {format(
              pointer.occurrence,
              pointer.isAllDay ? "EEEE, MMMM d, yyyy" : "EEEE, MMMM d, yyyy 'at' h:mm a",
            )}
          </p>
          {pointer.location && <p className="text-gray-500 text-sm">{pointer.location}</p>}
        </div>
      ) : (
        <p className="text-gray-500">No upcoming meeting is scheduled — check back soon.</p>
      )}

      <div className="mt-4 pt-4 border-t border-gray-100">
        {mostRecentApproved ? (
          <Link
            href={`/members/records/${mostRecentApproved.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            Read {mostRecentApproved.meetingDate}&rsquo;s minutes
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
            </svg>
          </Link>
        ) : (
          <p className="text-sm text-gray-400">
            No approved {minutesKindLabel(kind).toLowerCase()} minutes are posted yet.
          </p>
        )}
      </div>
    </div>
  );
}
