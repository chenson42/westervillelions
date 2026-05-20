/**
 * Shared row type for admin event attendee tables.
 *
 * Used by:
 *  - occurrence-rsvp-section.tsx (recurring event path)
 *  - admin-event-rsvp-table.tsx  (non-recurring event path)
 *  - write-in-form.tsx           (onAdded callback)
 *  - admin/events/[id]/page.tsx  (server-side row mapping)
 */
export interface AdminRsvpRow {
  /** Primary key of the event_rsvps row. */
  id: string;
  /** Non-null for member signups; null for guest write-ins. */
  userId: string | null;
  /** "attending" | "maybe" | "declined" */
  status: string;
  /** ISO timestamp string (wall-clock, same convention as occurrenceDate). */
  createdAt: string;
  /** Display name: userName for members, rsvpName for guests. */
  name: string | null;
  /** Display email: userEmail for members, rsvpEmail for guests. */
  email: string | null;
  /**
   * True when userId is null.
   * Derived from userId (NOT from rsvpEmail) so that walk-up guests
   * with no email are still identified as guests.
   */
  isGuest: boolean;
  /** Number of additional guests the member brought. 0 for write-ins. */
  guestCount: number | null;
  /** Answer to the event's extra question. null for write-ins. */
  extraAnswer: string | null;
}
