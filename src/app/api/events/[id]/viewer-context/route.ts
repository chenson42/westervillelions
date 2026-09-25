import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, users } from "@/lib/db/schema";
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
 *
 * `signeesByDate` (added in the Phase 6 rework of
 * docs/work-log/2026-09-25-recurring-occurrence-visibility.md) is the real
 * per-occurrence roster of names, keyed the same way
 * eventRsvps.occurrenceDate is (a wall-clock string, or the literal "null"
 * for a non-recurring event's single RSVP). The page's server render must
 * NEVER embed real signee names in its own baseline — that data crosses into
 * the Client Component's serialized props, which ship to the browser
 * regardless of session (this is the bug the Phase 6 rework fixed).
 *
 * Unlike `isSignedUp`/`userName`/`attachedFiles` — which are always the
 * caller's OWN data and are correctly gated on mere session presence
 * (`session?.user?.id`) — `signeesByDate` discloses OTHER members' names.
 * Google OAuth in this project allows sign-in from any Google account
 * (`src/lib/auth/index.ts`'s `signIn` callback); auto-linking to a `members`
 * row only happens for `@westervillelions.org` addresses matched by name.
 * A first-time sign-in from an unrelated Google account therefore produces a
 * valid session with `user.id` set but `user.memberId` unset — exactly the
 * "authenticated, not yet a linked member" case CLAUDE.md routes to
 * `/access-pending` elsewhere. `/events/[id]` is public and ungated, so that
 * session can still reach this route. `signeesByDate` is gated on
 * `session?.user?.memberId`, not `session?.user?.id`, so that caller gets
 * `{}` and the name-bearing query never runs for them — same
 * never-fetch-then-hide discipline as the anonymous branch below. (Flagged
 * by the second Phase 6 pass on this work-log; closed here.)
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
      signeesByDate: {},
    });
  }

  // signeesByDate discloses other members' names, so it additionally
  // requires an actual linked member — not just an authenticated session.
  // See the doc comment above.
  const memberId = session.user.memberId ?? null;

  const [rsvps, allSignups] = await Promise.all([
    db
      .select({
        occurrenceDate: eventRsvps.occurrenceDate,
        status: eventRsvps.status,
        guestCount: eventRsvps.guestCount,
        extraAnswer: eventRsvps.extraAnswer,
      })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, session.user.id))),
    // Every active signup for the event, across every member — this is the
    // real roster. Only reached once we know the caller is a linked member.
    memberId
      ? db
          .select({
            occurrenceDate: eventRsvps.occurrenceDate,
            userName: users.name,
            rsvpName: eventRsvps.rsvpName,
          })
          .from(eventRsvps)
          .leftJoin(users, eq(eventRsvps.userId, users.id))
          .where(and(eq(eventRsvps.eventId, eventId), ne(eventRsvps.status, "declined")))
      : Promise.resolve([]),
  ]);

  // Non-recurring events key their single RSVP row with occurrenceDate=null.
  const nonRecurringRsvp = rsvps.find((r) => r.occurrenceDate === null) ?? null;

  // Per-occurrence "already signed up" flags for recurring events — mirrors
  // the page's old `ne(status, "declined")` filter for userSignupDates.
  const signedUpDates = rsvps
    .filter((r) => r.status !== "declined")
    .map((r) => r.occurrenceDate ?? "null");

  const signeesByDate: Record<string, string[]> = {};
  for (const r of allSignups) {
    const key = r.occurrenceDate ?? "null";
    const displayName = r.userName ?? r.rsvpName;
    if (displayName) {
      (signeesByDate[key] ??= []).push(displayName);
    }
  }

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
    signeesByDate,
  });
}
