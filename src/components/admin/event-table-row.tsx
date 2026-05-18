"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { parseWallClock } from "@/lib/events";

export type RsvpSummary = {
  attending: number;
  maybe: number;
  declined: number;
  total: number;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  startDate: string; // wall-clock string from DB (mode:"string")
  isAllDay: boolean;
  location: string | null;
  isPublic: boolean;
  requiresRsvp: boolean;
};

interface Props {
  event: EventRow;
  rsvpSummary: RsvpSummary | null;
  defaultExpanded: boolean;
}

export function EventTableRow({ event, rsvpSummary, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-6 py-4">
          <div className="flex items-start gap-2">
            {event.requiresRsvp ? (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 transition"
                aria-label={expanded ? "Collapse RSVP summary" : "Expand RSVP summary"}
              >
                {expanded
                  ? <ChevronDown className="h-4 w-4" />
                  : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            <div>
              <div className="font-medium text-gray-900">{event.title}</div>
              {event.description && (
                <div className="mt-1 text-sm text-gray-500 line-clamp-1">{event.description}</div>
              )}
            </div>
          </div>
        </td>
        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
          {format(
            parseWallClock(event.startDate),
            event.isAllDay ? "MMM d, yyyy" : "MMM d, yyyy, h:mm a"
          )}
        </td>
        <td className="px-6 py-4 text-sm text-gray-500">
          {event.location || "—"}
        </td>
        <td className="whitespace-nowrap px-6 py-4">
          <div className="flex flex-wrap gap-1">
            <span
              className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                event.isPublic
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {event.isPublic ? "Public" : "Members only"}
            </span>
            {event.requiresRsvp && (
              <span className="inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-lions-blue/10 text-lions-blue">
                RSVP
              </span>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
          <Link href={`/admin/events/${event.id}`} className="text-lions-blue hover:text-lions-blue-dark">
            Edit
          </Link>
        </td>
      </tr>

      {event.requiresRsvp && expanded && (
        <tr className="bg-blue-50">
          <td colSpan={5} className="px-6 py-3 pl-14">
            {rsvpSummary && rsvpSummary.total > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-green-700">✓ {rsvpSummary.attending} attending</span>
                <span className="font-medium text-yellow-600">~ {rsvpSummary.maybe} maybe</span>
                <span className="font-medium text-gray-500">✕ {rsvpSummary.declined} declined</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">{rsvpSummary.total} total</span>
                <Link
                  href={`/admin/events/${event.id}#attendance`}
                  className="ml-auto text-xs text-lions-blue hover:underline"
                >
                  View all RSVPs →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No responses yet</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
