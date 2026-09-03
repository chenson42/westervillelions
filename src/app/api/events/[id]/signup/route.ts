import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events, eventOccurrenceOverrides } from "@/lib/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { format } from "date-fns";
import { generateOccurrences, isValidOccurrence, dateKey, parseWallClock, nowEastern } from "@/lib/events";

/**
 * POST /api/events/[id]/signup
 * Sign the authenticated user up for an event (or a specific occurrence of a recurring event).
 * Login required.
 *
 * Request body:
 *   { occurrenceDate?: string }  // ISO timestamp — required for recurring events
 *
 * Responses:
 *   201  { id, eventId, userId, occurrenceDate, status, createdAt }
 *   200  { alreadySignedUp: true }  — idempotent: user is already attending
 *   400  Validation error
 *   401  Not authenticated
 *   404  Event not found
 *   409  Occurrence is full (cap reached or unique violation race condition)
 *   500  Server error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;

    // Fetch the event
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Signups must be enabled on the event
    if (!event.requiresRsvp) {
      return NextResponse.json(
        { error: "Signups are not enabled for this event" },
        { status: 400 }
      );
    }

    // Parse body (allow empty body for non-recurring events)
    const body = await request.json().catch(() => ({})) as { occurrenceDate?: string; extraAnswer?: string };

    // Validate the extra question (signing up means attending)
    let cleanedExtraAnswer: string | null = null;
    if (event.extraQuestion) {
      const trimmed = typeof body.extraAnswer === "string" ? body.extraAnswer.trim() : "";
      if (event.extraQuestionRequired && trimmed.length === 0) {
        return NextResponse.json(
          { error: `${event.extraQuestion} is required` },
          { status: 400 }
        );
      }
      if (event.extraQuestionType === "select" && trimmed.length > 0) {
        const options = (event.extraQuestionOptions ?? []) as string[];
        if (!options.includes(trimmed)) {
          return NextResponse.json({ error: "Invalid answer for question" }, { status: 400 });
        }
      }
      cleanedExtraAnswer = trimmed.length > 0 ? trimmed : null;
    }

    let parsedDate: Date | null = null;
    // Wall-clock string for DB comparisons (mode:"string" column). Format matches Postgres output.
    let parsedDateStr: string | null = null;

    if (event.isRecurring) {
      if (!body.occurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate is required for recurring events" },
          { status: 400 }
        );
      }

      parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
      // Convert to wall-clock string for DB comparisons
      parsedDateStr = format(parsedDate, "yyyy-MM-dd HH:mm:ss");

      // Validate against the generated occurrence list.
      // event.startDate is now a wall-clock string (mode:"string"). Parse it to Date
      // for the `from` argument so generateOccurrences starts from the series start.
      const allOccurrences = generateOccurrences(
        {
          isRecurring: event.isRecurring,
          startDate: event.startDate,
          recurrenceType: event.recurrenceType,
          recurrenceDays: event.recurrenceDays,
          recurrenceEndDate: event.recurrenceEndDate,
        },
        parseWallClock(event.startDate)
      );

      if (!isValidOccurrence(parsedDate, allOccurrences)) {
        return NextResponse.json({ error: "Invalid occurrence date" }, { status: 400 });
      }

      // Reject signups for past occurrences. parsedDate is wall-clock (Eastern) —
      // compare against nowEastern(), not new Date(), or this misreads "past" up
      // to ~5 hours early whenever the server process isn't running in Eastern
      // local time (see docs/work-log/2026-09-03-server-timezone-event-visibility.md).
      if (parsedDate < nowEastern()) {
        return NextResponse.json(
          { error: "Cannot sign up for a past occurrence" },
          { status: 400 }
        );
      }

      // Reject signups for cancelled occurrences
      // Match on YYYY-MM-DD string — same format stored in event_occurrence_overrides.occurrence_date
      // Use dateKey() (local components) not toISOString().slice(0,10) (UTC). See DECISION-005.
      const occurrenceDateKey = dateKey(parsedDate);
      const cancellation = await db.query.eventOccurrenceOverrides.findFirst({
        where: and(
          eq(eventOccurrenceOverrides.eventId, eventId),
          eq(eventOccurrenceOverrides.occurrenceDate, occurrenceDateKey)
        ),
      });
      if (cancellation) {
        return NextResponse.json(
          { error: "This occurrence has been cancelled" },
          { status: 400 }
        );
      }
    }

    // Idempotency: if the user is already signed up (status != 'declined'), return 200
    const existingRsvp = await db.query.eventRsvps.findFirst({
      where: and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, session.user.id),
        parsedDateStr
          ? eq(eventRsvps.occurrenceDate, parsedDateStr)
          : isNull(eventRsvps.occurrenceDate)
      ),
    });

    if (existingRsvp && existingRsvp.status !== "declined") {
      return NextResponse.json({ alreadySignedUp: true }, { status: 200 });
    }

    // Cap check: total attendees = number of RSVPs + sum of their guests
    if (event.maxAttendees !== null && event.maxAttendees !== undefined) {
      const [{ total: attendeeTotal }] = await db
        .select({
          total: sql<number>`COALESCE(SUM(1 + COALESCE(${eventRsvps.guestCount}, 0)), 0)::int`,
        })
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, eventId),
            parsedDateStr
              ? eq(eventRsvps.occurrenceDate, parsedDateStr)
              : isNull(eventRsvps.occurrenceDate),
            ne(eventRsvps.status, "declined")
          )
        );

      if (Number(attendeeTotal) >= event.maxAttendees) {
        return NextResponse.json({ error: "This occurrence is full" }, { status: 409 });
      }
    }

    // Insert (or re-activate a previously declined row)
    try {
      if (existingRsvp) {
        // Row exists but status is 'declined' — update to 'attending'
        const [updated] = await db
          .update(eventRsvps)
          .set({ status: "attending", extraAnswer: cleanedExtraAnswer, updatedAt: new Date() })
          .where(eq(eventRsvps.id, existingRsvp.id))
          .returning();
        return NextResponse.json(
          {
            id: updated.id,
            eventId: updated.eventId,
            userId: updated.userId,
            occurrenceDate: updated.occurrenceDate ?? null,
            status: updated.status,
            createdAt: updated.createdAt.toISOString(),
          },
          { status: 201 }
        );
      }

      const [created] = await db
        .insert(eventRsvps)
        .values({
          eventId,
          userId: session.user.id,
          occurrenceDate: parsedDateStr ?? null,
          status: "attending",
          extraAnswer: cleanedExtraAnswer,
        })
        .returning();

      return NextResponse.json(
        {
          id: created.id,
          eventId: created.eventId,
          userId: created.userId,
          occurrenceDate: created.occurrenceDate ?? null,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        },
        { status: 201 }
      );
    } catch (error) {
      // Postgres unique violation — race condition: another request filled the last slot
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "This occurrence is full" }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error("Error signing up for event:", error);
    return NextResponse.json({ error: "Failed to sign up for event" }, { status: 500 });
  }
}

/**
 * DELETE /api/events/[id]/signup
 * Cancel the authenticated user's signup for an event (or a specific occurrence).
 * Login required. Idempotent — returns 200 even when no row exists.
 *
 * Request body:
 *   { occurrenceDate?: string }  // ISO timestamp — required for recurring events
 *
 * Responses:
 *   200  { success: true }
 *   401  Not authenticated
 *   404  Event not found
 *   500  Server error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;

    // Verify event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Parse optional body
    const body = await request.json().catch(() => ({})) as { occurrenceDate?: string };

    let parsedDateStr: string | null = null;
    if (body.occurrenceDate) {
      const parsed = new Date(body.occurrenceDate);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
      parsedDateStr = format(parsed, "yyyy-MM-dd HH:mm:ss");
    }

    // Delete the matching row (idempotent — no error if row not found)
    await db.delete(eventRsvps).where(
      and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, session.user.id),
        parsedDateStr
          ? eq(eventRsvps.occurrenceDate, parsedDateStr)
          : isNull(eventRsvps.occurrenceDate)
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error canceling event signup:", error);
    return NextResponse.json({ error: "Failed to cancel signup" }, { status: 500 });
  }
}
