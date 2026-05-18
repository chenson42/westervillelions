export interface OccurrenceRow {
  date: string; // ISO timestamp
  displayDate: string; // formatted for display, e.g. "Mon, May 5 at 6:00 PM"
  signedUpCount: number;
  isSignedUp: boolean;
  isFull: boolean;
  isPast: boolean;
  signees: string[]; // member names signed up for this occurrence
  isCancelled: boolean; // true when an event_occurrence_overrides row exists for this date
  cancellationReason: string | null; // shown in subdued text when provided
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
