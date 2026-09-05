import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getAllAttachedFiles, getPublicAttachedFiles } from "@/lib/club-files-queries";

/**
 * GET /api/events/[id]/viewer-context
 *
 * Everything about /events/[id] that depends on *who's looking* rather than
 * the event itself: whether the viewer is signed in, their own RSVP/signup
 * state, and the attached-files list scoped to their membership. Batch 2
 * (docs/work-log/2026-09-04-site-review-fixes.md) moved this out of the
 * page's server render — the page used to call auth() directly, which
 * forced every request dynamic (cache-control: no-store) even for
 * anonymous visitors, who are the overwhelming majority on a public event
 * page. The page now renders a signed-out baseline (public files only, no
 * occurrence marked "signed up") that Next can cache/ISR, and
 * EventPersonalization (client) fetches this route on mount to fill in the
 * viewer-specific pieces — same flash-of-signed-out pattern as Header.
 *
 * Always 200, even for anonymous requests, so the client widget never needs
 * a special-cased error path for "not logged in".
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const session = await auth().catch(() => null);

  const attachedFiles = session?.user?.memberId
    ? await getAllAttachedFiles(eventId)
    : await getPublicAttachedFiles(eventId);

  if (!session?.user?.id) {
    return NextResponse.json({
      isLoggedIn: false,
      userName: null,
      signedUpDates: [],
      userRsvp: null,
      attachedFiles,
    });
  }

  const rsvps = await db
    .select({
      occurrenceDate: eventRsvps.occurrenceDate,
      status: eventRsvps.status,
      guestCount: eventRsvps.guestCount,
      extraAnswer: eventRsvps.extraAnswer,
    })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, session.user.id)));

  // Non-recurring events key their single RSVP row with occurrenceDate=null.
  const nonRecurringRsvp = rsvps.find((r) => r.occurrenceDate === null) ?? null;

  // Per-occurrence "already signed up" flags for recurring events — mirrors
  // the page's old `ne(status, "declined")` filter for userSignupDates.
  const signedUpDates = rsvps
    .filter((r) => r.status !== "declined")
    .map((r) => r.occurrenceDate ?? "null");

  return NextResponse.json({
    isLoggedIn: true,
    userName: session.user.name ?? null,
    signedUpDates,
    userRsvp: nonRecurringRsvp
      ? {
          status: nonRecurringRsvp.status,
          guestCount: nonRecurringRsvp.guestCount,
          extraAnswer: nonRecurringRsvp.extraAnswer,
        }
      : null,
    attachedFiles,
  });
}
