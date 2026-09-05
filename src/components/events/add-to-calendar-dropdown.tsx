"use client";

// See: docs/work-log/2026-05-20-add-to-calendar-dropdown.md (Phase 3, sections 1–9)
// D6: Google/Outlook → target="_blank" rel="noopener noreferrer", no download
//     Apple/Download .ics → download attribute, no target="_blank"
// D7: shadcn DropdownMenu provides keyboard navigation and focus management
// D8: Trigger uses py-2.5 and items use px-4 py-2.5 for 44px touch targets
// D9: Calendar icon on left, ChevronDown on right; "Add to Calendar" default label
// D12: null googleUrl/outlookUrl → item renders disabled with title tooltip

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AddToCalendarDropdownProps = {
  /**
   * Event ID — used to construct the ICS download URL.
   */
  eventId: string;

  /**
   * YYYY-MM-DD occurrence date for a specific occurrence.
   * When omitted, the ICS links target the full series download (no ?occurrence=).
   */
  occurrence?: string;

  /**
   * Pre-built Google Calendar TEMPLATE URL.
   * null → Google Calendar item is disabled with "No upcoming occurrences" tooltip.
   */
  googleUrl: string | null;

  /**
   * Pre-built Outlook.com deeplink URL.
   * null → Outlook item is disabled with "No upcoming occurrences" tooltip.
   */
  outlookUrl: string | null;

  /**
   * Whether the Google/Outlook items should show "(next occurrence only)"
   * in their label. True only for the series-level dropdown on a recurring event.
   * Default: false.
   */
  isSeriesLevel?: boolean;

  /**
   * Button label for the dropdown trigger.
   * Default: "Add to Calendar" (per-occurrence) or "Add full series to Calendar" (series-level).
   * Callers pass this explicitly for the series case.
   */
  label?: string;

  /**
   * Additional Tailwind classes for the trigger button.
   */
  className?: string;
};

/**
 * A four-item dropdown for adding a Lions Club event to a calendar provider.
 *
 * Items: Google Calendar, Apple Calendar (.ics download), Outlook.com, Download .ics.
 *
 * - Google/Outlook items open the provider's web UI in a new tab.
 * - Apple Calendar and Download .ics items trigger the ICS download endpoint.
 * - When googleUrl/outlookUrl is null (no future occurrence), those items are disabled.
 */
export function AddToCalendarDropdown({
  eventId,
  occurrence,
  googleUrl,
  outlookUrl,
  isSeriesLevel = false,
  label,
  className = "",
}: AddToCalendarDropdownProps) {
  const defaultLabel = "Add to Calendar";
  const resolvedLabel = label ?? defaultLabel;

  const icsUrl = occurrence
    ? `/api/events/${eventId}/ics?occurrence=${occurrence}`
    : `/api/events/${eventId}/ics`;

  const googleLabel = isSeriesLevel
    ? "Google Calendar (next occurrence only)"
    : "Google Calendar";
  const outlookLabel = isSeriesLevel
    ? "Outlook (next occurrence only)"
    : "Outlook";

  const triggerClasses = [
    "inline-flex items-center gap-2",
    "border-2 border-lions-blue text-lions-blue",
    "px-4 py-2.5 rounded-lg text-sm font-semibold",
    "hover:bg-lions-blue/5 transition",
    "focus:outline-none focus:ring-2 focus:ring-lions-blue",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add to Calendar options"
          className={triggerClasses}
        >
          {/* Calendar icon — same SVG as previous AddToCalendarButton */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>{resolvedLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="bottom"
        // Radix's default collision-avoidance flips the panel above the
        // trigger whenever the visible viewport below is short — which, on
        // a scrollable mobile event list, meant it routinely opened upward
        // and covered the event title instead of just letting the page
        // scroll (site-review batch 4, 2026-09-04). This panel is only ~4
        // short items, so always opening downward reads better than a
        // collision-driven flip.
        avoidCollisions={false}
        className="min-w-[220px] bg-white text-gray-900 border border-gray-200 shadow-lg"
      >
        {/* Google Calendar — web link, new tab, disabled when no URL */}
        <DropdownMenuItem
          disabled={googleUrl === null}
          title={googleUrl === null ? "No upcoming occurrences" : undefined}
          className="px-4 py-2.5 cursor-pointer focus:bg-lions-blue/5 focus:text-lions-blue data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
          asChild={googleUrl !== null}
        >
          {googleUrl !== null ? (
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center"
            >
              {googleLabel}
            </a>
          ) : (
            <span>{googleLabel}</span>
          )}
        </DropdownMenuItem>

        {/* Apple Calendar — ICS download */}
        <DropdownMenuItem
          className="px-4 py-2.5 cursor-pointer focus:bg-lions-blue/5 focus:text-lions-blue"
          asChild
        >
          <a
            href={icsUrl}
            download
            title="Downloads a .ics file. Open it to add to your calendar app."
            className="flex w-full items-center"
          >
            Apple Calendar
          </a>
        </DropdownMenuItem>

        {/* Outlook — web link, new tab, disabled when no URL */}
        <DropdownMenuItem
          disabled={outlookUrl === null}
          title={outlookUrl === null ? "No upcoming occurrences" : undefined}
          className="px-4 py-2.5 cursor-pointer focus:bg-lions-blue/5 focus:text-lions-blue data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
          asChild={outlookUrl !== null}
        >
          {outlookUrl !== null ? (
            <a
              href={outlookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center"
            >
              {outlookLabel}
            </a>
          ) : (
            <span>{outlookLabel}</span>
          )}
        </DropdownMenuItem>

        {/* Download .ics — explicit fallback download */}
        <DropdownMenuItem
          className="px-4 py-2.5 cursor-pointer focus:bg-lions-blue/5 focus:text-lions-blue"
          asChild
        >
          <a
            href={icsUrl}
            download
            title="Downloads a .ics file. Open it to add to your calendar app."
            className="flex w-full items-center"
          >
            Download .ics
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
