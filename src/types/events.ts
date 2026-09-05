export interface OccurrenceRow {
  date: string; // ISO timestamp
  /** Local-time YYYY-MM-DD key (from dateKey()). Used for ICS occurrence param. */
  dateKey: string;
  /**
   * Wall-clock "yyyy-MM-dd HH:mm:ss" key matching eventRsvps.occurrenceDate
   * exactly (see DECISION-005) — used client-side to match this row against
   * the viewer's own signed-up dates from /api/events/[id]/viewer-context,
   * since `date` (ISO/UTC) and `dateKey` (date-only) don't round-trip to the
   * same string the DB stores.
   */
  rsvpKey: string;
  displayDate: string; // formatted for display, e.g. "Mon, May 5 at 6:00 PM"
  signedUpCount: number;
  isSignedUp: boolean;
  isFull: boolean;
  isPast: boolean;
  signees: string[]; // member names signed up for this occurrence
  isCancelled: boolean; // true when an event_occurrence_overrides row exists for this date
  cancellationReason: string | null; // shown in subdued text when provided
  /** Pre-built Google Calendar TEMPLATE URL for this occurrence. null if unavailable. */
  googleUrl: string | null;
  /** Pre-built Outlook.com deeplink URL for this occurrence. null if unavailable. */
  outlookUrl: string | null;
}

export interface SignupApiRequest {
  occurrenceDate?: string;
}

export interface SignupApiResponse {
  id: string;
  eventId: string;
  userId: string;
  occurrenceDate: string | null;
  status: "attending";
  createdAt: string;
}
