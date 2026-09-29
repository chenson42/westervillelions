"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatWallClockDate, parseWallClock, type EventSiblingFanOutField } from "@/lib/events";

export type SiblingSummaryRow = { id: string; startDate: string; isAllDay: boolean };

const FIELD_LABELS: Record<EventSiblingFanOutField, string> = {
  location: "Location",
  description: "Description",
  isPublic: "Public",
  requiresRsvp: "Allow Signups / RSVP",
  maxAttendees: "Max Attendees",
  allowGuestCount: "Allow guest count",
  extraQuestion: "Custom RSVP question",
  extraQuestionType: "Custom RSVP question answer type",
  extraQuestionOptions: "Custom RSVP question dropdown options",
  extraQuestionRequired: "Custom RSVP question required",
};

function formatFieldValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (value === null || value === undefined || value === "") return "(none)";
  return String(value);
}

export function ApplyToSiblingsControl({
  siblingSummary,
  loadedTitle,
  currentTitle,
  checked,
  onCheckedChange,
  confirmOpen,
  onConfirmOpenChange,
  changedFields,
  fieldValues,
  onConfirm,
}: {
  /** Sibling rows computed at page load — frozen, from the event's as-loaded title. */
  siblingSummary: SiblingSummaryRow[];
  /** The event's title as loaded from the DB — this is what the sibling match is against. */
  loadedTitle: string;
  /** The title field's current (possibly just-edited) value, for the "title changed" note. */
  currentTitle: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  changedFields: EventSiblingFanOutField[];
  fieldValues: Record<string, unknown>;
  onConfirm: () => void;
}) {
  if (siblingSummary.length === 0) return null;

  const n = siblingSummary.length;
  const titleChanged = currentTitle !== loadedTitle;

  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="applyToSiblings"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 min-h-[20px] min-w-[20px] rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
        />
        <label htmlFor="applyToSiblings" className="text-sm text-gray-700">
          Also apply to {n} other upcoming &quot;{loadedTitle}&quot; event{n === 1 ? "" : "s"}
        </label>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={onConfirmOpenChange}
        title="Apply changes to other events?"
        description={
          <div className="space-y-4">
            <div>
              <p className="font-medium text-gray-800">Changing:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {changedFields.map((field) => (
                  <li key={field}>
                    {FIELD_LABELS[field]}: {formatFieldValue(fieldValues[field])}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-800">
                Also applies to {n} other upcoming &quot;{loadedTitle}&quot; event{n === 1 ? "" : "s"}:
              </p>
              <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
                {siblingSummary.map((s) => (
                  <li key={s.id}>{formatWallClockDate(parseWallClock(s.startDate), s.isAllDay)}</li>
                ))}
              </ul>
            </div>
            {changedFields.includes("requiresRsvp") && (
              <p className="text-gray-700">Existing RSVPs on these events are kept.</p>
            )}
            {titleChanged && (
              <p className="text-gray-700">
                These are matched by the original title &quot;{loadedTitle}&quot; — renaming this
                event to &quot;{currentTitle}&quot; in this save does not change which events are
                included.
              </p>
            )}
          </div>
        }
        confirmLabel="Save and Apply"
        onConfirm={onConfirm}
      />
    </div>
  );
}
